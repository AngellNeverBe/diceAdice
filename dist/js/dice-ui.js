import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { DICE_TYPES, MAX_TOTAL_DICE, AVAILABLE_THEMES } from './config.js';
import {
    scene, world, camera, renderer,
    modelMeshesByName, typeCache, modelsLoaded, mapsLoaded,
    buildTableAndWalls, loadModels, aspect, frustumSize,
    resetModelState, setAspect
} from './engine.js';

// ===================== 主题状态 =====================
export let currentTheme = 'base';

// ===================== 骰子配置 =====================
export const diceConfig = {
    d20: 1,
    d12: 0,
    d10: 0,
    d8: 0,
    d6: 0,
    d4: 0
};

export function getTotalDiceCount() {
    return Object.values(diceConfig).reduce((a, b) => a + b, 0);
}

// ===================== 骰子对象管理 =====================
export let diceObjects = [];
export let resultShown = false;
export let stableFrames = 0;
export let throwTime = 0;

export function setResultShown(v) { resultShown = v; }
export function setStableFrames(v) { stableFrames = v; }
export function setThrowTime(v) { throwTime = v; }

// ===================== 射线检测与悬浮高亮 =====================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredDiceObj = null;
let hoveredOriginalEmissive = null;

function clearHoverHighlight() {
    if (hoveredDiceObj && hoveredOriginalEmissive) {
        const mat = hoveredDiceObj.mesh.material;
        const materials = Array.isArray(mat) ? mat : [mat];
        materials.forEach(m => {
            m.emissive.copy(hoveredOriginalEmissive.color);
            m.emissiveIntensity = hoveredOriginalEmissive.intensity;
        });
        hoveredDiceObj = null;
        hoveredOriginalEmissive = null;
    }
    renderer.domElement.style.cursor = 'default';
}

export function clearAllDice() {
    clearHoverHighlight();
    diceObjects.forEach(obj => {
        if (obj.body) world.removeBody(obj.body);
        if (obj.mesh) scene.remove(obj.mesh);
    });
    diceObjects = [];
}

function getTopResultForDice(diceObj) {
    const { mesh, type } = diceObj;
    const cache = typeCache[type];
    if (!cache) return null;
    const worldUp = new THREE.Vector3(0, 1, 0);
    if (type === 'd4') {
        let maxY = -Infinity, topIdx = -1;
        const matrix = mesh.matrixWorld;
        const verts = cache.vertices;
        for (let i = 0; i < verts.length; i++) {
            const worldPos = verts[i].clone().applyMatrix4(matrix);
            if (worldPos.y > maxY) { maxY = worldPos.y; topIdx = i; }
        }
        const num = cache.map.vertex[topIdx];
        return { index: topIdx, num, type };
    } else {
        let maxDot = -1, topIdx = -1;
        const matrix = mesh.matrixWorld;
        const normals = cache.normals;
        for (let i = 0; i < normals.length; i++) {
            const worldNormal = normals[i].clone().applyMatrix4(matrix);
            const dot = worldNormal.dot(worldUp);
            if (dot > maxDot) { maxDot = dot; topIdx = i; }
        }
        const num = cache.map.face[topIdx];
        return { index: topIdx, num, type };
    }
}

function getAllDiceResults() {
    const results = [];
    diceObjects.forEach(obj => {
        const res = getTopResultForDice(obj);
        if (res && res.num !== undefined) results.push({ type: res.type, num: res.num });
    });
    const grouped = {};
    results.forEach(r => {
        if (!grouped[r.type]) grouped[r.type] = [];
        grouped[r.type].push(r.num);
    });
    return { results, grouped };
}

export function showAllResults() {
    const { results, grouped } = getAllDiceResults();
    const div = document.getElementById('diceResult');
    if (results.length === 0) { div.style.display = 'none'; return; }
    const total = results.reduce((s, r) => s + r.num, 0);
    let html = '<div class="result-list">';
    const typeOrder = DICE_TYPES.filter(t => grouped[t] && grouped[t].length > 0);
    typeOrder.forEach(t => {
        const nums = grouped[t];
        html += `<span class="result-detail type-label">${t}:</span>`;
        nums.forEach(n => { html += `<span class="result-detail">${n}</span>`; });
        if (t !== typeOrder[typeOrder.length - 1]) html += ' ';
    });
    html += '</div>';
    html += `<div class="result-total">🎲 总和 = ${total}</div>`;
    div.innerHTML = html;
    div.style.display = 'block';
    return total;
}

export function hideResults() {
    document.getElementById('diceResult').style.display = 'none';
}

// ===================== 骰子排列与重建 =====================
function arrangeDicePositions(count) {
    if (count === 0) return [];
    const tableW = frustumSize * aspect;
    const tableD = frustumSize;
    const spacingX = Math.min(1.6, (tableW - 1.5) / Math.max(count, 1));
    const spacingZ = 1.5;
    const maxPerRow = Math.max(1, Math.floor((tableW - 1.5) / spacingX));
    const positions = [];
    for (let i = 0; i < count; i++) {
        const row = Math.floor(i / maxPerRow);
        const col = i % maxPerRow;
        const totalInRow = Math.min(maxPerRow, count - row * maxPerRow);
        const startX = -(totalInRow - 1) * spacingX / 2;
        const x = startX + col * spacingX;
        const z = (row - Math.floor((count - 1) / maxPerRow) / 2) * spacingZ;
        positions.push({ x, z, y: -0.3 });
    }
    return positions;
}

export function rebuildDice() {
    if (!modelsLoaded || !mapsLoaded) return;
    clearAllDice();
    hideResults();
    resultShown = false;
    stableFrames = 0;
    throwTime = 0;
    const totalCount = getTotalDiceCount();
    if (totalCount === 0) { updateUI(); return; }
    const positions = arrangeDicePositions(totalCount);
    let posIndex = 0;
    DICE_TYPES.forEach(type => {
        const count = diceConfig[type];
        if (count <= 0) return;
        const template = modelMeshesByName[type];
        if (!template) return;
        const cache = typeCache[type];
        if (!cache) return;
        for (let i = 0; i < count; i++) {
            const mesh = template.clone();
            if (Array.isArray(mesh.material)) {
                mesh.material = mesh.material.map(m => m.clone());
            } else {
                mesh.material = mesh.material.clone();
            }
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const body = new CANNON.Body({ mass: 0.2, shape: cache.shape });
            body.linearDamping = 0.1;
            body.angularDamping = 0.2;
            const pos = positions[posIndex] || { x: 0, z: 0, y: -0.3 };
            body.position.set(pos.x, pos.y, pos.z);
            body.quaternion.setFromEuler(
                Math.random() * 0.6 - 0.3,
                Math.random() * Math.PI * 2,
                Math.random() * 0.6 - 0.3
            );
            body.wakeUp();
            world.addBody(body);
            mesh.position.copy(body.position);
            mesh.quaternion.copy(body.quaternion);
            scene.add(mesh);
            diceObjects.push({ mesh, body, type });
            posIndex++;
        }
    });
    updateUI();
}

export function updateUI() {
    const totalCount = getTotalDiceCount();
    document.getElementById('totalCount').textContent = totalCount;
    DICE_TYPES.forEach(type => {
        const el = document.getElementById('count-' + type);
        if (el) el.textContent = diceConfig[type];
    });
    const btnThrow = document.getElementById('btnThrow');
    btnThrow.disabled = totalCount === 0;
    btnThrow.textContent = totalCount === 0 ? '请添加骰子' : '按[空格]投掷';
}

export function adjustDiceCount(type, delta) {
    const newVal = diceConfig[type] + delta;
    if (newVal < 0) return;
    const currentTotal = getTotalDiceCount();
    if (delta > 0 && currentTotal >= MAX_TOTAL_DICE) {
        const totalEl = document.getElementById('totalCount');
        totalEl.style.color = '#ff4444';
        setTimeout(() => { totalEl.style.color = '#ffd700'; }, 300);
        return;
    }
    diceConfig[type] = newVal;
    rebuildDice();
}

// ===================== 投掷逻辑 =====================
export function throwAllDice() {
    if (diceObjects.length === 0) return;
    clearHoverHighlight();
    hideResults();
    resultShown = false;
    stableFrames = 0;
    throwTime = performance.now();
    const tableW = frustumSize * aspect;
    const tableD = frustumSize;
    diceObjects.forEach((obj) => {
        const x = (Math.random() - 0.5) * (tableW / 3.5);
        const y = Math.random() / 5 + 0.2;
        const z = (Math.random() - 0.5) * (tableD / 3.5);
        obj.body.position.set(x, y, z);
        obj.body.quaternion.setFromEuler(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );
        obj.body.velocity.set(
            (Math.random() - 0.5) * 4,
            Math.random() + 0.5,
            (Math.random() - 0.5) * 4
        );
        obj.body.angularVelocity.set(
            (Math.random() / 2 + 1) * 8,
            (Math.random() / 2 + 1) * 4,
            (Math.random() / 2 + 1) * 8
        );
        obj.body.wakeUp();
    });
}

export function throwSingleDice(diceObj) {
    clearHoverHighlight();
    hideResults();
    resultShown = false;
    stableFrames = 0;
    throwTime = performance.now();
    diceObj.body.velocity.set(
        (Math.random() - 0.5) * 2,
        Math.random() * 2 + 3,
        (Math.random() - 0.5) * 2
    );
    diceObj.body.angularVelocity.set(
        (Math.random() / 2 + 1) * 8,
        (Math.random() / 2 + 1) * 4,
        (Math.random() / 2 + 1) * 8
    );
    diceObj.body.wakeUp();
}

// ===================== 主题切换 =====================
let isSwitchingTheme = false;

export async function switchTheme(newTheme) {
    if (isSwitchingTheme) return;
    if (newTheme === currentTheme) return;

    const themeBtns = document.querySelectorAll('.theme-btn');
    const throwBtn = document.getElementById('btnThrow');

    isSwitchingTheme = true;
    themeBtns.forEach(b => b.disabled = true);
    throwBtn.disabled = true;

    try {
        clearAllDice();
        resetModelState();

        await loadModels(newTheme);
        currentTheme = newTheme;

        themeBtns.forEach(b => {
            b.classList.toggle('active', b.dataset.theme === newTheme);
        });

        if (mapsLoaded) {
            rebuildDice();
        }
    } catch (err) {
        alert(`无法加载主题"${newTheme}"的模型文件，请确保 models/dices_${newTheme}.glb 存在。`);
        if (currentTheme !== newTheme) {
            try {
                await loadModels(currentTheme);
                if (mapsLoaded) rebuildDice();
            } catch (e) {
                console.error('回退主题也失败了', e);
            }
        }
    } finally {
        themeBtns.forEach(b => {
            b.disabled = false;
            b.classList.toggle('active', b.dataset.theme === currentTheme);
        });
        throwBtn.disabled = (getTotalDiceCount() === 0);
        isSwitchingTheme = false;
    }
}

// ===================== 窗口缩放处理 =====================
export function onResize() {
    const newAspect = innerWidth / innerHeight;
    setAspect(newAspect);
    camera.left = -frustumSize * newAspect / 2;
    camera.right = frustumSize * newAspect / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    buildTableAndWalls();
    if (modelsLoaded && mapsLoaded && !resultShown && getTotalDiceCount() > 0) {
        const positions = arrangeDicePositions(getTotalDiceCount());
        let posIdx = 0;
        diceObjects.forEach(obj => {
            if (posIdx < positions.length) {
                const p = positions[posIdx];
                obj.body.position.set(p.x, p.y, p.z);
                obj.body.wakeUp();
                posIdx++;
            }
        });
        stableFrames = 0;
        throwTime = 0;
    }
}

// ===================== 鼠标悬浮与点击事件 =====================
function onDiceMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const meshes = diceObjects.map(obj => obj.mesh);
    const intersects = raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0 && resultShown) {
        const hitMesh = intersects[0].object;
        const diceObj = diceObjects.find(obj => obj.mesh === hitMesh);
        if (diceObj && diceObj !== hoveredDiceObj) {
            clearHoverHighlight();
            hoveredDiceObj = diceObj;
            const mat = diceObj.mesh.material;
            const materials = Array.isArray(mat) ? mat : [mat];
            hoveredOriginalEmissive = {
                color: materials[0].emissive.clone(),
                intensity: materials[0].emissiveIntensity
            };
            materials.forEach(m => {
                m.emissive.set(0xffaa00);
                m.emissiveIntensity = 0.6;
            });
            renderer.domElement.style.cursor = 'pointer';
        }
    } else {
        clearHoverHighlight();
    }
}

function onDiceClick(event) {
    if (event.target.closest('#dicePanel')) return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const meshes = diceObjects.map(obj => obj.mesh);
    const intersects = raycaster.intersectObjects(meshes, false);
    if (intersects.length > 0 && resultShown) {
        const hitMesh = intersects[0].object;
        const diceObj = diceObjects.find(obj => obj.mesh === hitMesh);
        if (diceObj) throwSingleDice(diceObj);
    }
}

// ===================== 事件绑定 =====================
export function bindEvents() {
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            if (theme && AVAILABLE_THEMES.includes(theme)) {
                switchTheme(theme);
            }
        });
    });

    window.addEventListener('keydown', e => {
        if (e.code === 'Space' && diceObjects.length > 0) {
            e.preventDefault();
            throwAllDice();
        }
    });

    document.getElementById('dicePanel').addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.classList.contains('theme-btn')) return;
        if (btn.id === 'btnThrow') {
            if (diceObjects.length > 0) throwAllDice();
            return;
        }
        if (btn.id === 'btnClear') {
            DICE_TYPES.forEach(t => { diceConfig[t] = 0; });
            rebuildDice();
            return;
        }
        const row = btn.closest('.dice-row');
        if (!row) return;
        const type = row.dataset.diceType;
        const action = btn.dataset.action;
        if (!type || !action) return;
        if (action === 'plus') adjustDiceCount(type, 1);
        if (action === 'minus') adjustDiceCount(type, -1);
    });

    renderer.domElement.addEventListener('mousemove', onDiceMouseMove);
    renderer.domElement.addEventListener('click', onDiceClick);

    renderer.domElement.addEventListener('dblclick', () => {
        if (diceObjects.length > 0) throwAllDice();
    });

    window.addEventListener('resize', onResize);
}
