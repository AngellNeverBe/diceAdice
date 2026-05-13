import * as THREE from 'three';
import { STABLE_THRESHOLD, VEL_EPS, ANG_EPS, MAX_WAIT_MS } from './config.js';
import {
    scene, world, camera, renderer,
    mapsLoaded,
    buildTableAndWalls, loadExternalMaps, loadModels,
    frustumSize, aspect
} from './engine.js';
import {
    currentTheme,
    diceObjects, resultShown, stableFrames, throwTime,
    setResultShown, setStableFrames, setThrowTime,
    rebuildDice, showAllResults,
    bindEvents
} from './dice-ui.js';

// ===================== 渲染循环 =====================
const physClock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(physClock.getDelta(), 1 / 15);
    world.step(1 / 60, dt, 10);
    diceObjects.forEach(obj => {
        obj.mesh.position.copy(obj.body.position);
        obj.mesh.quaternion.copy(obj.body.quaternion);
        const limitX = (frustumSize * aspect) / 2 - 0.2;
        const limitZ = frustumSize / 2 - 0.2;
        obj.body.position.x = Math.max(-limitX, Math.min(limitX, obj.body.position.x));
        obj.body.position.z = Math.max(-limitZ, Math.min(limitZ, obj.body.position.z));
        obj.body.position.y = Math.max(-0.7, obj.body.position.y);
    });
    if (diceObjects.length > 0 && !resultShown) {
        let allSlow = true, maxVel = 0, maxAng = 0;
        diceObjects.forEach(obj => {
            const vel = obj.body.velocity.length();
            const ang = obj.body.angularVelocity.length();
            if (vel > maxVel) maxVel = vel;
            if (ang > maxAng) maxAng = ang;
            if (vel >= VEL_EPS || ang >= ANG_EPS) allSlow = false;
        });
        const now = performance.now();
        const timeoutReached = (throwTime > 0) && (now - throwTime > MAX_WAIT_MS);
        if (allSlow) setStableFrames(stableFrames + 1);
        else setStableFrames(0);
        const shouldStop = !resultShown && (stableFrames >= STABLE_THRESHOLD || (timeoutReached && maxVel < 0.15 && maxAng < 0.15));
        if (shouldStop) {
            const total = showAllResults();
            if (total !== undefined) {
                console.log(`[停稳] ${diceObjects.length}个骰子 → 总和 ${total}  (${(now - throwTime).toFixed(0)}ms)`);
            }
            setResultShown(true);
            setStableFrames(0);
            setThrowTime(0);
        }
    }
    renderer.render(scene, camera);
}

// ===================== 初始化 =====================
function init() {
    buildTableAndWalls();
    bindEvents();
    animate();

    // 启动：先加载映射，再加载默认主题模型
    loadExternalMaps().then(() => {
        loadModels(currentTheme).then(() => {
            if (mapsLoaded) rebuildDice();
        });
    });

    console.log('🎲 骰子桌面已启动（默认主题：base）');
}

init();
