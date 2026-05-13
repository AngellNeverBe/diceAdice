import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import * as CANNON from 'cannon-es';
import { JSON_PATH, DICE_TYPES, DEFAULT_MAPS } from './config.js';

// ===================== 视口状态 =====================
export const frustumSize = 6;
export let aspect = innerWidth / innerHeight;

// ===================== 基础场景 =====================
export const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0a14');

export const camera = new THREE.OrthographicCamera(
    frustumSize * aspect / -2,
    frustumSize * aspect / 2,
    frustumSize / 2,
    frustumSize / -2,
    0.1,
    20
);
camera.position.set(0, 5, 0);
camera.lookAt(0, 0, 0);

export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// 光照
const ambient = new THREE.AmbientLight(0xccddff, 1.0);
scene.add(ambient);
const mainLight = new THREE.DirectionalLight(0xffeedd, 5);
mainLight.position.set(5, 16, -5);
mainLight.castShadow = true;
mainLight.shadow.mapSize.width = 2048;
mainLight.shadow.mapSize.height = 2048;
mainLight.shadow.camera.near = 0.5;
mainLight.shadow.camera.far = 30;
mainLight.shadow.bias = -0.0005;
mainLight.shadow.camera.left = -10;
mainLight.shadow.camera.right = 10;
mainLight.shadow.camera.top = 10;
mainLight.shadow.camera.bottom = -10;
scene.add(mainLight);
const fillLight = new THREE.DirectionalLight(0xccddff, 0.1);
fillLight.position.set(-5, 16, 5);
scene.add(fillLight);

// ===================== 物理世界 =====================
export const world = new CANNON.World();
world.gravity.set(0, -16, 0);
world.broadphase = new CANNON.SAPBroadphase(world);
world.defaultContactMaterial.restitution = 0.3;
world.defaultContactMaterial.friction = 0.02;
world.solver.iterations = 20;

const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
groundBody.position.y = -0.8;
world.addBody(groundBody);

// ===================== 动态桌面与边框 =====================
let tableMesh;
const wallMeshes = [];
const wallBodies = [];

export function buildTableAndWalls() {
    if (tableMesh) scene.remove(tableMesh);
    wallMeshes.forEach(m => scene.remove(m));
    wallBodies.forEach(b => world.removeBody(b));
    wallMeshes.length = 0;
    wallBodies.length = 0;

    const w = frustumSize * aspect;
    const h = frustumSize;

    const tableGeo = new THREE.PlaneGeometry(w, h);
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.7 });
    tableMesh = new THREE.Mesh(tableGeo, tableMat);
    tableMesh.rotation.x = -Math.PI / 2;
    tableMesh.position.y = -0.8;
    tableMesh.receiveShadow = true;
    tableMesh.visible = false;
    scene.add(tableMesh);

    const wallMat = new THREE.MeshStandardMaterial({
        color: 0x334455, roughness: 0.5, transparent: true, opacity: 0.4
    });
    const wallThickness = 2000, wallHeight = 2000, inwardMargin = 0;
    const halfW = w / 2, halfH = h / 2;

    const positions = [
        [0, -0.8 + wallHeight/2, -halfH - wallThickness/2 + inwardMargin, w + wallThickness, wallHeight, wallThickness],
        [0, -0.8 + wallHeight/2,  halfH + wallThickness/2 - inwardMargin, w + wallThickness, wallHeight, wallThickness],
        [-halfW - wallThickness/2 + inwardMargin, -0.8 + wallHeight/2, 0, wallThickness, wallHeight, h + wallThickness],
        [ halfW + wallThickness/2 - inwardMargin, -0.8 + wallHeight/2, 0, wallThickness, wallHeight, h + wallThickness]
    ];

    positions.forEach(([x, y, z, sx, sy, sz]) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat);
        mesh.position.set(x, y, z);
        mesh.receiveShadow = true;
        mesh.visible = false;
        scene.add(mesh);
        wallMeshes.push(mesh);
        const body = new CANNON.Body({
            mass: 0,
            shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2))
        });
        body.position.set(x, y, z);
        world.addBody(body);
        wallBodies.push(body);
    });

    const ceilingY = 4.5, ceilingThickness = 0.2;
    const ceilingGeo = new THREE.BoxGeometry(w + wallThickness, ceilingThickness, h + wallThickness);
    const ceilingMat = new THREE.MeshStandardMaterial({
        color: 0x334455, roughness: 0.5, transparent: true, opacity: 0.2, visible: false
    });
    const ceilingMesh = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceilingMesh.position.set(0, ceilingY, 0);
    ceilingMesh.receiveShadow = true;
    ceilingMesh.visible = false;
    scene.add(ceilingMesh);
    wallMeshes.push(ceilingMesh);
    const ceilingBody = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(
            (w + wallThickness) / 2, ceilingThickness / 2, (h + wallThickness) / 2
        ))
    });
    ceilingBody.position.set(0, ceilingY, 0);
    world.addBody(ceilingBody);
    wallBodies.push(ceilingBody);
}

// ===================== 模型存储与类型缓存 =====================
export let modelMeshesByName = {};
export let modelsLoaded = false;
export let mapsLoaded = false;
export const typeCache = {};
export let activeMaps = { ...DEFAULT_MAPS };

export function resetModelState() {
    modelsLoaded = false;
    modelMeshesByName = {};
}
export function setAspect(v) { aspect = v; }
export function setMapsLoaded(v) { mapsLoaded = v; }

function extractGeometryData(geometry) {
    const index = geometry.index;
    const pos = geometry.attributes.position;
    const normals = [];
    const vertices = [];
    const vertSet = new Set();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < index.count; i += 3) {
        const i0 = index.getX(i), i1 = index.getX(i+1), i2 = index.getX(i+2);
        a.fromBufferAttribute(pos, i0);
        b.fromBufferAttribute(pos, i1);
        c.fromBufferAttribute(pos, i2);
        const ab = b.clone().sub(a), ac = c.clone().sub(a);
        const normal = new THREE.Vector3().crossVectors(ab, ac).normalize();
        normals.push(normal.clone());
    }
    for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
        const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
        if (!vertSet.has(key)) {
            vertSet.add(key);
            vertices.push(v);
        }
    }
    return { normals, vertices };
}

export function createDiceShape(geometry) {
    const posAttr = geometry.attributes.position;
    const vertexSet = new Set();
    const rawVertices = [];
    for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
        if (isNaN(x) || isNaN(y) || isNaN(z)) continue;
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
        const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
        if (!vertexSet.has(key)) {
            vertexSet.add(key);
            rawVertices.push(new THREE.Vector3(x, y, z));
        }
    }
    if (rawVertices.length < 4) {
        console.warn('顶点不足，使用盒体代替');
        return new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));
    }
    const hull = new ConvexHull();
    hull.setFromPoints(rawVertices);
    const hullFaces = hull.faces;
    const hullVertices = [];
    const vertexMap = new Map();
    const faces = [];
    hullFaces.forEach(face => {
        const faceVerts = [];
        let edge = face.edge;
        do {
            const v = edge.head().point;
            const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
            let idx = vertexMap.get(key);
            if (idx === undefined) {
                idx = vertexMap.size;
                vertexMap.set(key, idx);
                hullVertices.push(v.clone());
            }
            faceVerts.push(idx);
            edge = edge.next;
        } while (edge !== face.edge);
        for (let i = 1; i < faceVerts.length - 1; i++) {
            faces.push([faceVerts[0], faceVerts[i], faceVerts[i + 1]]);
        }
    });
    const cannonVerts = hullVertices.map(v => new CANNON.Vec3(v.x, v.y, v.z));
    const center = new CANNON.Vec3();
    cannonVerts.forEach(v => center.vadd(v, center));
    center.scale(1 / cannonVerts.length, center);
    const orientedFaces = faces.map(([a, b, c]) => {
        const av = cannonVerts[a], bv = cannonVerts[b], cv = cannonVerts[c];
        const normal = bv.vsub(av).cross(cv.vsub(av));
        const faceCenter = av.vadd(bv).vadd(cv).scale(1/3);
        if (normal.dot(faceCenter.vsub(center)) < 0) {
            return [c, b, a];
        }
        return [a, b, c];
    });
    return new CANNON.ConvexPolyhedron({
        vertices: cannonVerts,
        faces: orientedFaces
    });
}

export function buildTypeCache(type, templateMesh) {
    if (typeCache[type]) return;
    const geom = templateMesh.geometry;
    const data = extractGeometryData(geom);
    const shape = createDiceShape(geom);
    const map = activeMaps[type] || DEFAULT_MAPS[type];
    typeCache[type] = { normals: data.normals, vertices: data.vertices, shape: shape, map: map };
    console.log(`[缓存] ${type}: ${data.normals.length} 个三角面`);
}

// ===================== 资源加载 =====================
export async function loadExternalMaps() {
    try {
        const response = await fetch(JSON_PATH);
        if (!response.ok) throw new Error('JSON 加载失败');
        const json = await response.json();
        if (json && typeof json === 'object') {
            DICE_TYPES.forEach(t => {
                if (json[t]) activeMaps[t] = json[t];
            });
        }
        console.log('✅ 已加载外部映射文件:', JSON_PATH);
    } catch (err) {
        console.warn('⚠️ 外部映射加载失败，使用内联默认映射:', err.message);
        activeMaps = { ...DEFAULT_MAPS };
    } finally {
        mapsLoaded = true;
    }
}

export function loadModels(theme) {
    return new Promise(async (resolve, reject) => {
        try {
            const glbPath = `./models/dices_${theme}.glb`;
            const response = await fetch(glbPath);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buf = await response.arrayBuffer();
            const glb = new Uint8Array(buf);

            // 从 GLB 中提取图片并预解码为 ImageBitmap
            const dv = new DataView(buf);
            const jsonLen = dv.getUint32(12, true);
            const gltfJson = JSON.parse(new TextDecoder().decode(glb.slice(20, 20+jsonLen)));
            let binOff = 0;
            if (20+jsonLen < buf.byteLength) {
                const cLen = dv.getUint32(20+jsonLen, true);
                const cType = dv.getUint32(20+jsonLen+4, true);
                if (cType === 0x004E4942) binOff = 20+jsonLen+8;
            }
            const bitmaps = {};
            if (gltfJson.images && binOff>0) {
                for (let i=0; i<gltfJson.images.length; i++) {
                    const img = gltfJson.images[i];
                    if (img.bufferView!==undefined) {
                        const bv = gltfJson.bufferViews[img.bufferView];
                        const bytes = glb.slice(binOff+bv.byteOffset, binOff+bv.byteOffset+bv.byteLength);
                        try {
                            const bmp = await createImageBitmap(new Blob([bytes],{type:img.mimeType||'image/png'}));
                            bitmaps[i] = bmp;
                        } catch(e) { /* 该纹理无法解码，跳过 */ }
                    }
                }
            }

            const loader = new GLTFLoader();
            loader.parse(buf, '', (gltf) => {
                const gltfTexArr = (gltfJson.textures||[]).map(tex => ({source:tex.source, sampler:tex.sampler}));

                gltf.scene.traverse((node) => {
                    if (!node.isMesh || !node.material) return;
                    const mats = Array.isArray(node.material) ? node.material : [node.material];
                    const gltfMats = gltfJson.materials||[];
                    mats.forEach(mat => {
                        gltfMats.forEach(gltfMat => {
                            const pbr = gltfMat.pbrMetallicRoughness||{};
                            const slotMap = {
                                map: pbr.baseColorTexture,
                                roughnessMap: pbr.metallicRoughnessTexture,
                                metalnessMap: pbr.metallicRoughnessTexture,
                                normalMap: gltfMat.normalTexture,
                                emissiveMap: gltfMat.emissiveTexture,
                                aoMap: gltfMat.occlusionTexture
                            };
                            Object.entries(slotMap).forEach(([slot, texRef]) => {
                                if (!texRef) return;
                                const imgIdx = gltfTexArr[texRef.index]?.source;
                                if (imgIdx!==undefined && bitmaps[imgIdx]) {
                                    const t = new THREE.Texture(bitmaps[imgIdx]);
                                    t.colorSpace = (slot === 'map') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
                                    t.needsUpdate = true;
                                    mat[slot] = t;
                                }
                            });
                        });
                    });
                });

                const allMeshes = [];
                gltf.scene.traverse(c => { if (c.isMesh) allMeshes.push(c); });
                modelMeshesByName = {};
                allMeshes.forEach(mesh => {
                    const name = mesh.name.trim();
                    if (DICE_TYPES.includes(name) && !modelMeshesByName[name]) {
                        modelMeshesByName[name] = mesh;
                    }
                });
                Object.keys(typeCache).forEach(k => delete typeCache[k]);
                DICE_TYPES.forEach(type => {
                    if (modelMeshesByName[type]) buildTypeCache(type, modelMeshesByName[type]);
                });
                modelsLoaded = true;
                resolve();
            }, (err) => { console.error('解析失败:', err); reject(err); });
        } catch(err) { console.error('加载失败:', err); reject(err); }
    });
}
