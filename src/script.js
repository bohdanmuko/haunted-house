import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Timer } from 'three/addons/misc/Timer.js'
import { Sky } from 'three/addons/objects/Sky.js'
import GUI from 'lil-gui'
import * as Sound from './audio.js'

/**
 * Одиниці виміру: 1 одиниця = 1 метр. Рівень землі — y = 0.
 */

/**
 * Base
 */
const gui = new GUI({ title: 'Налаштування сцени', width: 320 })
gui.close() // на телефонах панель не закриває сцену; відкривається кліком

const canvas = document.querySelector('canvas.webgl')
const scene = new THREE.Scene()

// Детермінований генератор випадкових чисел — сцена однакова при кожному запуску
let seed = 20061
const random = () =>
{
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
}
const rand = (min, max) => min + random() * (max - min)

/**
 * Параметри (усе, що керується повзунками)
 */
const params = {
    // небо
    turbidity: 10,
    rayleigh: 3,
    mieCoefficient: 0.1,
    mieDirectionalG: 0.95,
    sunElevation: -2.2,
    sunAzimuth: 162.5,
    stars: 0.9,
    // туман
    fogDensity: 0.055,
    fogColor: '#04343f',
    // світло
    ambientColor: '#86cdff',
    ambientIntensity: 0.275,
    moonColor: '#86cdff',
    moonIntensity: 1,
    moonElevation: 14,
    moonAzimuth: 160,
    doorColor: '#ff7d46',
    doorIntensity: 5,
    flickerSpeed: 1,
    flickerAmount: 0.6,
    windowGlow: 1,
    shadows: true,
    // привиди
    ghostSpeed: 1,
    ghostIntensity: 6,
    ghostVisible: true,
    // анімація
    doorCreak: true,
    autoRotate: false,
    autoRotateSpeed: 0.6,
    // звук
    volume: 0.7,
    wind: 0.5,
    drone: 0.5,
    crickets: 0.4
}

/**
 * Завантаження: LoadingManager показує прогрес
 */
const loaderEl = document.getElementById('loader')
const loaderBar = document.getElementById('loaderBar')
const loaderText = document.getElementById('loaderText')
const loadingManager = new THREE.LoadingManager()
loadingManager.onProgress = (url, loaded, total) =>
{
    loaderBar.style.width = `${(loaded / total) * 100}%`
    loaderText.textContent = `Завантаження текстур… ${loaded}/${total}`
}
loadingManager.onLoad = () =>
{
    loaderBar.style.width = '100%'
    loaderEl.classList.add('done')
    setTimeout(() => loaderEl.remove(), 1000)
}

/**
 * Textures
 */
const textureLoader = new THREE.TextureLoader(loadingManager)

// Завантажує текстуру з потрібним colorSpace і повторенням
const loadTexture = (path, { srgb = false, repeat = [1, 1] } = {}) =>
{
    const texture = textureLoader.load(path)
    if(srgb) texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeat[0], repeat[1])
    return texture
}

// Набір «колір + ARM + нормаль» (ARM = ambient occlusion / roughness / metalness в R/G/B)
const loadPBR = (folder, name, repeat) => ({
    color: loadTexture(`./${folder}/${name}_diff_1k.webp`, { srgb: true, repeat }),
    arm: loadTexture(`./${folder}/${name}_arm_1k.webp`, { repeat }),
    normal: loadTexture(`./${folder}/${name}_nor_gl_1k.webp`, { repeat })
})

// Зберігаємо базове повторення, щоб повзунок працював як множник
const repeatSets = {}
const registerRepeat = (key, textures, base) =>
{
    repeatSets[key] = { textures, base }
}
const applyRepeat = (key, multiplier) =>
{
    const { textures, base } = repeatSets[key]
    textures.forEach((t) => t.repeat.set(base[0] * multiplier, base[1] * multiplier))
}

// Підлога
const floorAlphaTexture = loadTexture('./floor/alpha.webp')
const floorTex = loadPBR('floor/coast_sand_rocks_02_1k', 'coast_sand_rocks_02', [9, 9])
const floorDisplacementTexture = loadTexture('./floor/coast_sand_rocks_02_1k/coast_sand_rocks_02_disp_1k.webp', { repeat: [9, 9] })
registerRepeat('floor', [floorTex.color, floorTex.arm, floorTex.normal, floorDisplacementTexture], [9, 9])

// Стіни (цегла)
const wallTex = loadPBR('wall/castle_brick_broken_06_1k', 'castle_brick_broken_06', [1, 1])
registerRepeat('wall', Object.values(wallTex), [1, 1])

// Дах
const roofTex = loadPBR('roof/roof_slates_02_1k', 'roof_slates_02', [3, 1])
registerRepeat('roof', Object.values(roofTex), [3, 1])

// Кущі
const bushTex = loadPBR('bush/leaves_forest_ground_1k', 'leaves_forest_ground', [2, 1])
registerRepeat('bush', Object.values(bushTex), [2, 1])

// Могили
const graveTex = loadPBR('grave/plastered_stone_wall_1k', 'plastered_stone_wall', [0.3, 0.4])
registerRepeat('grave', Object.values(graveTex), [0.3, 0.4])

// Двері
const doorTex = {
    color: loadTexture('./door/color.webp', { srgb: true }),
    alpha: loadTexture('./door/alpha.webp'),
    ao: loadTexture('./door/ambientOcclusion.webp'),
    height: loadTexture('./door/height.webp'),
    normal: loadTexture('./door/normal.webp'),
    metalness: loadTexture('./door/metalness.webp'),
    roughness: loadTexture('./door/roughness.webp')
}

// Каміння / плити доріжок: ті самі файли, що й для підлоги, але окремі об'єкти Texture з власним повторенням
// (clone() до завершення завантаження не працює — у клона ще немає зображення)
const rockTex = loadPBR('floor/coast_sand_rocks_02_1k', 'coast_sand_rocks_02', [1.5, 1.5])

// Процедурна текстура дерева (малюється на canvas) — для паркану, сараю, табличок
const makeWoodTexture = () =>
{
    const size = 512
    const cvs = document.createElement('canvas')
    cvs.width = cvs.height = size
    const c = cvs.getContext('2d')
    const planks = 4
    const w = size / planks
    for(let p = 0; p < planks; p++)
    {
        const l = 30 + rand(-5, 6)
        c.fillStyle = `hsl(${26 + rand(-4, 4)}, ${32 + rand(-6, 6)}%, ${l}%)`
        c.fillRect(p * w, 0, w, size)
        // річні кільця / волокна
        for(let i = 0; i < 70; i++)
        {
            const x = p * w + rand(2, w - 2)
            c.strokeStyle = `rgba(${random() > 0.5 ? '25,12,4' : '120,80,45'},${rand(0.06, 0.22)})`
            c.lineWidth = rand(0.5, 2.2)
            c.beginPath()
            c.moveTo(x, 0)
            c.bezierCurveTo(x + rand(-5, 5), size * 0.33, x + rand(-5, 5), size * 0.66, x + rand(-4, 4), size)
            c.stroke()
        }
        // сучок
        if(random() > 0.4)
        {
            const kx = p * w + rand(20, w - 20)
            const ky = rand(40, size - 40)
            c.fillStyle = 'rgba(30,14,5,0.55)'
            c.beginPath()
            c.ellipse(kx, ky, rand(5, 9), rand(8, 15), 0, 0, Math.PI * 2)
            c.fill()
        }
        // щілина між дошками
        c.fillStyle = 'rgba(10,5,2,0.85)'
        c.fillRect(p * w, 0, 3, size)
    }
    const color = new THREE.CanvasTexture(cvs)
    color.colorSpace = THREE.SRGBColorSpace
    color.wrapS = color.wrapT = THREE.RepeatWrapping
    color.anisotropy = 4
    const bump = new THREE.CanvasTexture(cvs)
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping
    return { color, bump }
}
const woodTex = makeWoodTexture()

/**
 * Матеріали
 */
const floorMaterial = new THREE.MeshStandardMaterial({
    transparent: true,
    alphaMap: floorAlphaTexture,
    map: floorTex.color,
    aoMap: floorTex.arm,
    roughnessMap: floorTex.arm,
    metalnessMap: floorTex.arm,
    normalMap: floorTex.normal,
    displacementMap: floorDisplacementTexture,
    displacementScale: 0.3,
    displacementBias: -0.2
})

const makePBRMaterial = (tex, extra = {}) => new THREE.MeshStandardMaterial({
    map: tex.color,
    aoMap: tex.arm,
    roughnessMap: tex.arm,
    metalnessMap: tex.arm,
    normalMap: tex.normal,
    ...extra
})

const wallMaterial = makePBRMaterial(wallTex)
const garageWallMaterial = makePBRMaterial(wallTex, { color: '#b9c4c9' }) // світліше, «сіре» — гараж
const chimneyMaterial = makePBRMaterial(wallTex, { color: '#6b5b55' })
const roofMaterial = makePBRMaterial(roofTex)
const bushMaterial = makePBRMaterial(bushTex, { color: '#ccffcc' })
const graveMaterial = makePBRMaterial(graveTex)
const rockMaterial = makePBRMaterial(rockTex, { color: '#8a8f94' })
const slabMaterial = makePBRMaterial(rockTex, { color: '#5d6266' })

const doorMaterial = new THREE.MeshStandardMaterial({
    transparent: true,
    map: doorTex.color,
    alphaMap: doorTex.alpha,
    aoMap: doorTex.ao,
    displacementMap: doorTex.height,
    displacementScale: 0.15,
    displacementBias: -0.04,
    normalMap: doorTex.normal,
    metalnessMap: doorTex.metalness,
    roughnessMap: doorTex.roughness
})

const makeWoodMaterial = (color) => new THREE.MeshStandardMaterial({
    map: woodTex.color,
    bumpMap: woodTex.bump,
    bumpScale: 2,
    roughness: 0.92,
    color
})
const fenceMaterial = makeWoodMaterial('#b8b0a8')
const shedMaterial = makeWoodMaterial('#9d8a7a')
const outhouseMaterial = makeWoodMaterial('#c9a77f')
const darkWoodMaterial = makeWoodMaterial('#6f625a')

const metalMaterial = new THREE.MeshStandardMaterial({ color: '#7d8a91', metalness: 0.7, roughness: 0.45 })
const garageDoorMaterial = new THREE.MeshStandardMaterial({ color: '#8e9aa0', metalness: 0.6, roughness: 0.5 })
const frameMaterial = new THREE.MeshStandardMaterial({ color: '#3b2a20', roughness: 0.8 })

// Скло вікон світиться теплим світлом (emissive), яскравістю керуємо в tick()
const glassMaterials = []
const makeGlassMaterial = () =>
{
    const m = new THREE.MeshStandardMaterial({
        color: '#2a2a1a',
        emissive: '#ffb347',
        emissiveIntensity: 1,
        roughness: 0.2
    })
    glassMaterials.push(m)
    return m
}

const pumpkinMaterial = new THREE.MeshStandardMaterial({ color: '#e0661a', emissive: '#ff5a00', emissiveIntensity: 0.35, roughness: 0.6 })
const stemMaterial = new THREE.MeshStandardMaterial({ color: '#3d4a1e', roughness: 0.9 })

/**
 * Допоміжні функції геометрії
 */
// Перераховує UV для BoxGeometry так, щоб розмір текстури був однаковий у метрах на всіх гранях
// tile — скільки метрів займає одне повторення текстури
const worldUV = (geometry, w, h, d, tileU = 2, tileV = tileU) =>
{
    const uv = geometry.attributes.uv
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]] // +x, -x, +y, -y, +z, -z
    for(let f = 0; f < 6; f++)
    {
        for(let v = 0; v < 4; v++)
        {
            const i = f * 4 + v
            uv.setXY(i, uv.getX(i) * dims[f][0] / tileU, uv.getY(i) * dims[f][1] / tileV)
        }
    }
    uv.needsUpdate = true
    return geometry
}

const makeBox = (w, h, d, material, tileU = 2, tileV = tileU) =>
{
    const mesh = new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, h, d), w, h, d, tileU, tileV), material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
}

const place = (object, x, y, z, ry = 0) =>
{
    object.position.set(x, y, z)
    object.rotation.y = ry
    return object
}

// Зручно для групи: усі меші в ній кидають і приймають тіні
const shadowAll = (object, cast = true, receive = true) =>
{
    object.traverse((child) =>
    {
        if(child.isMesh)
        {
            child.castShadow = cast
            child.receiveShadow = receive
        }
    })
}

/**
 * Floor
 */
const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 26, 100, 100), floorMaterial)
floor.rotation.x = -Math.PI * 0.5
floor.receiveShadow = true
scene.add(floor)

/**
 * House
 */
const house = new THREE.Group()
scene.add(house)

// Головний об'єм
const walls = makeBox(4, 2.5, 4, wallMaterial, 2)
walls.position.y = 1.25
house.add(walls)

// Дах-піраміда
const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.6, 4), roofMaterial)
roof.position.y = 2.5 + 0.8
roof.rotation.y = Math.PI * 0.25
roof.castShadow = true
house.add(roof)

// Димар
const chimney = makeBox(0.55, 1.5, 0.55, chimneyMaterial, 1)
chimney.position.set(1.0, 3.55, -0.9)
house.add(chimney)
const chimneyCap = makeBox(0.75, 0.12, 0.75, slabMaterial, 1)
chimneyCap.position.set(1.0, 4.35, -0.9)
house.add(chimneyCap)

// Фундамент і ґанок
const foundation = makeBox(4.2, 0.3, 4.2, slabMaterial, 1.5)
foundation.position.y = 0.15
house.add(foundation)
const step = makeBox(1.8, 0.18, 0.7, slabMaterial, 1)
step.position.set(0, 0.09, 2.45)
house.add(step)

// Двері (PlaneGeometry з великою кількістю сегментів — потрібно для displacementMap)
const door = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2, 100, 100), doorMaterial)
door.position.set(0, 1.1, 2 + 0.01)
house.add(door)
const doorFrame = new THREE.Group()
{
    const side = new THREE.BoxGeometry(0.12, 2.3, 0.12)
    const left = new THREE.Mesh(side, frameMaterial)
    left.position.set(-0.97, 1.15, 2.05)
    const right = left.clone()
    right.position.x = 0.97
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.12, 0.12), frameMaterial)
    top.position.set(0, 2.25, 2.05)
    doorFrame.add(left, right, top)
}
shadowAll(doorFrame)
house.add(doorFrame)

// Ліхтар над дверима: корпус + світна лампа (її емісія миготить разом із PointLight)
const lampBulbMaterial = new THREE.MeshStandardMaterial({ color: '#331a0a', emissive: '#ff9a5a', emissiveIntensity: 2 })
const lantern = new THREE.Group()
{
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.32), metalMaterial)
    bracket.position.set(0, 0, 0.16)
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.12, 6), metalMaterial)
    cap.position.set(0, 0.2, 0.34)
    const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.26, 10), lampBulbMaterial)
    bulb.position.set(0, 0.04, 0.34)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.08, 0.05, 8), metalMaterial)
    base.position.set(0, -0.12, 0.34)
    lantern.add(bracket, cap, bulb, base)
}
lantern.position.set(0, 2.5, 2.0)
house.add(lantern)

// Вікно: рама + світне скло + перемички
const makeWindow = (w = 0.9, h = 1.0) =>
{
    const group = new THREE.Group()
    const t = 0.07
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), makeGlassMaterial())
    group.add(glass)
    const top = new THREE.Mesh(new THREE.BoxGeometry(w + t * 2, t, 0.1), frameMaterial)
    top.position.y = h / 2 + t / 2
    const bottom = top.clone()
    bottom.position.y = -h / 2 - t / 2
    const left = new THREE.Mesh(new THREE.BoxGeometry(t, h, 0.1), frameMaterial)
    left.position.x = -w / 2 - t / 2
    const right = left.clone()
    right.position.x = w / 2 + t / 2
    const barV = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, 0.05), frameMaterial)
    barV.position.z = 0.02
    const barH = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.05), frameMaterial)
    barH.position.z = 0.02
    const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.07, 0.2), slabMaterial)
    sill.position.set(0, -h / 2 - 0.1, 0.06)
    group.add(top, bottom, left, right, barV, barH, sill)
    shadowAll(group, true, false)
    return group
}
const windowFrontL = place(makeWindow(), -1.35, 1.6, 2.02)
const windowFrontR = place(makeWindow(), 1.35, 1.6, 2.02)
const windowLeft = place(makeWindow(), -2.02, 1.6, 0.2, -Math.PI / 2)
const windowBack = place(makeWindow(), 0.8, 1.6, -2.02, Math.PI)
house.add(windowFrontL, windowFrontR, windowLeft, windowBack)

/**
 * Гараж (прибудований праворуч від будинку)
 */
const garage = new THREE.Group()
scene.add(garage)
{
    const body = makeBox(3.3, 2.1, 3.4, garageWallMaterial, 2)
    body.position.set(3.55, 1.05, -0.1)
    garage.add(body)

    // Односхилий дах із нахилом до фасаду
    const garageRoof = makeBox(3.8, 0.14, 4.0, roofMaterial, 2.7, 0.9)
    garageRoof.position.set(3.55, 2.22, -0.05)
    garageRoof.rotation.x = 0.09
    garage.add(garageRoof)

    // Секційні гаражні ворота: 5 панелей
    const panelH = 0.38
    for(let i = 0; i < 5; i++)
    {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(2.5, panelH - 0.03, 0.06), garageDoorMaterial)
        panel.position.set(3.55, 0.2 + i * panelH, 1.62 + 0.03)
        panel.castShadow = true
        panel.receiveShadow = true
        garage.add(panel)
    }
    const doorFrameTop = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.14, 0.12), frameMaterial)
    doorFrameTop.position.set(3.55, 2.02, 1.66)
    const doorFrameL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.0, 0.12), frameMaterial)
    doorFrameL.position.set(2.25, 1.0, 1.66)
    const doorFrameR = doorFrameL.clone()
    doorFrameR.position.x = 4.85
    garage.add(doorFrameTop, doorFrameL, doorFrameR)

    // Ручка воріт та лампа над ними
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.06), metalMaterial)
    handle.position.set(3.55, 0.75, 1.72)
    garage.add(handle)
    const garageLampArm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.2), metalMaterial)
    garageLampArm.position.set(3.55, 2.12, 1.76)
    const garageLamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), lampBulbMaterial)
    garageLamp.position.set(3.55, 2.06, 1.88)
    garage.add(garageLampArm, garageLamp)

    // Бокове вікно гаража
    const garageWindow = place(makeWindow(0.7, 0.5), 5.22, 1.4, -0.1, Math.PI / 2)
    garage.add(garageWindow)
}

/**
 * Сарай (ззаду ліворуч)
 */
const shed = new THREE.Group()
{
    const body = makeBox(2.6, 2.0, 2.2, shedMaterial, 1.5)
    body.position.y = 1.0
    shed.add(body)

    // Двосхилий дах з двох плит
    for(const side of [-1, 1])
    {
        const slab = makeBox(1.7, 0.1, 2.7, roofMaterial, 2.0, 0.9)
        slab.position.set(side * 0.72, 2.28, 0)
        slab.rotation.z = -side * 0.5
        shed.add(slab)
    }
    // Щити фронтону (трикутники)
    const gableShape = new THREE.Shape()
    gableShape.moveTo(-1.3, 0)
    gableShape.lineTo(1.3, 0)
    gableShape.lineTo(0, 0.8)
    gableShape.closePath()
    const gable = new THREE.Mesh(new THREE.ShapeGeometry(gableShape), shedMaterial)
    gable.position.set(0, 2.0, 1.105)
    const gableBack = gable.clone()
    gableBack.position.z = -1.105
    gableBack.rotation.y = Math.PI
    shed.add(gable, gableBack)

    // Двері сараю
    const shedDoor = makeBox(0.95, 1.7, 0.08, darkWoodMaterial, 1)
    shedDoor.position.set(0, 0.88, 1.13)
    shed.add(shedDoor)
    const shedLock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.05), metalMaterial)
    shedLock.position.set(0.3, 0.88, 1.2)
    shed.add(shedLock)
    // Хрестовина на дверях
    const brace = makeBox(1.1, 0.1, 0.04, darkWoodMaterial, 1)
    brace.position.set(0, 0.88, 1.19)
    brace.rotation.z = 0.8
    shed.add(brace)
}
shadowAll(shed)
place(shed, -6.3, 0, -5.6, 0.45)
scene.add(shed)

/**
 * Вуличний туалет (задній двір, праворуч) — двері повільно рипить на вітрі
 */
const outhouse = new THREE.Group()
let outhouseDoorPivot
{
    const body = makeBox(1.3, 2.1, 1.3, outhouseMaterial, 1.2)
    body.position.y = 1.05
    outhouse.add(body)

    // Односхилий дах
    const outhouseRoof = makeBox(1.7, 0.1, 1.8, roofMaterial, 2.0, 0.9)
    outhouseRoof.position.set(0, 2.2, 0.0)
    outhouseRoof.rotation.x = -0.18
    outhouse.add(outhouseRoof)

    // Двері на петлях — pivot у краю, щоб обертатися навколо петлі
    outhouseDoorPivot = new THREE.Group()
    outhouseDoorPivot.position.set(-0.47, 0, 0.67)
    const doorMesh = makeBox(0.94, 1.8, 0.06, darkWoodMaterial, 1)
    doorMesh.position.set(0.47, 0.98, 0.0)
    outhouseDoorPivot.add(doorMesh)

    // Півмісяць на дверях (ShapeGeometry з двох дуг)
    const moonShape = new THREE.Shape()
    moonShape.absarc(0, 0, 0.14, Math.PI * 0.5, Math.PI * 1.5, false)
    moonShape.absarc(0.05, 0, 0.11, Math.PI * 1.5, Math.PI * 0.5, true)
    const crescent = new THREE.Mesh(new THREE.ShapeGeometry(moonShape), new THREE.MeshStandardMaterial({ color: '#0d0a08', roughness: 1 }))
    crescent.position.set(0.47, 1.55, 0.035)
    outhouseDoorPivot.add(crescent)

    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), metalMaterial)
    knob.position.set(0.82, 0.95, 0.06)
    outhouseDoorPivot.add(knob)
    outhouse.add(outhouseDoorPivot)

    // Темне нутро, видно коли двері прочиняються
    const inside = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 1.8), new THREE.MeshBasicMaterial({ color: '#050302' }))
    inside.position.set(0, 0.98, 0.64)
    outhouse.add(inside)
}
shadowAll(outhouse)
place(outhouse, 6.6, 0, -6.4, -0.55)
scene.add(outhouse)

/**
 * Bushes
 */
const bushGeometry = new THREE.SphereGeometry(1, 16, 16)
const bushes = []
const bushData = [
    [0.8, 0.2, 2.6, 0.5], [1.5, 0.1, 2.45, 0.28], [-0.9, 0.1, 2.6, 0.42], [-1.35, 0.05, 2.95, 0.2],
    [-2.5, 0.2, 1.2, 0.45], [-2.45, 0.15, -0.6, 0.55], [2.0, 0.1, -2.3, 0.4], [5.6, 0.2, 1.0, 0.45],
    [-1.8, 0.15, -2.4, 0.5], [5.9, 0.12, 2.2, 0.35]
]
for(const [x, y, z, s] of bushData)
{
    const bush = new THREE.Mesh(bushGeometry, bushMaterial)
    bush.scale.setScalar(s)
    bush.position.set(x, y, z)
    bush.rotation.x = -0.75
    bush.castShadow = true
    bush.receiveShadow = true
    bushes.push(bush)
    scene.add(bush)
}

/**
 * Гарбузи біля ґанку (світяться — emissive)
 */
const pumpkins = []
const pumpkinData = [[-1.5, 2.9, 0.38], [-1.05, 3.15, 0.26], [1.75, 2.85, 0.32], [2.5, 2.4, 0.34]]
for(const [x, z, s] of pumpkinData)
{
    const pumpkin = new THREE.Group()
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), pumpkinMaterial)
    body.scale.set(1, 0.78, 1)
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.3, 6), stemMaterial)
    stem.position.y = 0.72
    stem.rotation.z = 0.2
    pumpkin.add(body, stem)
    pumpkin.scale.setScalar(s)
    pumpkin.position.set(x, s * 0.78, z)
    pumpkin.rotation.y = rand(0, 6)
    shadowAll(pumpkin)
    pumpkins.push(pumpkin)
    scene.add(pumpkin)
}

/**
 * Каміння (різні розміри, злегка приплюснуте)
 */
const rockGeometry = new THREE.IcosahedronGeometry(1, 1)
const rockSpots = [
    [-4.2, 3.5], [-4.6, 3.9], [4.6, 4.8], [7.4, -2.6], [-8, -1.5], [-7.7, -2.1], [2.2, -5.6],
    [-3.2, -7.4], [8.2, 3.6], [0.5, -8.4], [-6.8, 5.6], [7.0, 7.4], [3.0, 8.6]
]
for(const [x, z] of rockSpots)
{
    const rock = new THREE.Mesh(rockGeometry, rockMaterial)
    const s = rand(0.18, 0.5)
    rock.scale.set(s * rand(0.9, 1.5), s * rand(0.5, 0.8), s * rand(0.9, 1.4))
    rock.position.set(x, s * 0.25, z)
    rock.rotation.set(rand(-0.3, 0.3), rand(0, 6), rand(-0.3, 0.3))
    rock.castShadow = true
    rock.receiveShadow = true
    scene.add(rock)
}

/**
 * Доріжки: плитки (InstancedMesh) від ґанку до хвіртки + бетонна під'їзна доріжка до гаража
 */
const stoneGeometry = new THREE.CylinderGeometry(0.42, 0.46, 0.1, 7)
const pathCount = 8
const pathStones = new THREE.InstancedMesh(stoneGeometry, slabMaterial, pathCount)
const dummy = new THREE.Object3D()
for(let i = 0; i < pathCount; i++)
{
    dummy.position.set(Math.sin(i * 1.3) * 0.18, 0.04, 3.2 + i * 0.95)
    dummy.rotation.set(0, rand(0, 6), 0)
    dummy.scale.set(rand(0.9, 1.2), 1, rand(0.9, 1.2))
    dummy.updateMatrix()
    pathStones.setMatrixAt(i, dummy.matrix)
}
pathStones.castShadow = true
pathStones.receiveShadow = true
scene.add(pathStones)

const driveway = makeBox(2.6, 0.06, 8.4, slabMaterial, 2)
driveway.position.set(3.55, 0.03, 6.0)
scene.add(driveway)

/**
 * Паркан: стовпи + дві горизонтальні планки + штахетини (усе через InstancedMesh)
 */
const yardHalf = 10
const fenceSegments = []
const addFence = (x1, z1, x2, z2) => fenceSegments.push([x1, z1, x2, z2])
addFence(-yardHalf, -yardHalf, yardHalf, -yardHalf) // зад
addFence(-yardHalf, -yardHalf, -yardHalf, yardHalf) // ліво
addFence(yardHalf, -yardHalf, yardHalf, yardHalf) // право
addFence(-yardHalf, yardHalf, -1.0, yardHalf) // перед: ліва частина
addFence(1.0, yardHalf, 2.25, yardHalf) // між хвірткою та проїздом
addFence(4.85, yardHalf, yardHalf, yardHalf) // перед: права частина

const postGeometry = worldUV(new THREE.BoxGeometry(0.14, 1.25, 0.14), 0.14, 1.25, 0.14, 1)
const picketGeometry = worldUV(new THREE.BoxGeometry(0.11, 0.95, 0.03), 0.11, 0.95, 0.03, 1)
const railGeometry = new THREE.BoxGeometry(1, 0.08, 0.05)

const postMatrices = []
const picketMatrices = []
const railMatrices = []
const tmp = new THREE.Object3D()

const pushMatrix = (list, x, y, z, ry, sx = 1, sy = 1, sz = 1, rz = 0) =>
{
    tmp.position.set(x, y, z)
    tmp.rotation.set(0, ry, rz)
    tmp.scale.set(sx, sy, sz)
    tmp.updateMatrix()
    list.push(tmp.matrix.clone())
}

for(const [x1, z1, x2, z2] of fenceSegments)
{
    const length = Math.hypot(x2 - x1, z2 - z1)
    const dx = (x2 - x1) / length
    const dz = (z2 - z1) / length
    const ry = -Math.atan2(dz, dx)
    // Стовпи
    const postCount = Math.max(2, Math.round(length / 1.6) + 1)
    for(let i = 0; i < postCount; i++)
    {
        const t = (i / (postCount - 1)) * length
        pushMatrix(postMatrices, x1 + dx * t, 0.6, z1 + dz * t, ry, 1, rand(0.85, 1.05), 1, rand(-0.04, 0.04))
    }
    // Планки
    for(const y of [0.42, 0.85])
    {
        pushMatrix(railMatrices, x1 + dx * length / 2 + dz * 0.07, y, z1 + dz * length / 2 - dx * 0.07, ry, length, 1, 1)
    }
    // Штахетини: частина «зламана» — різна висота й нахил
    const picketCount = Math.floor(length / 0.26)
    for(let i = 0; i < picketCount; i++)
    {
        if(random() < 0.07) continue // пропущена дошка
        const t = ((i + 0.5) / picketCount) * length
        pushMatrix(
            picketMatrices,
            x1 + dx * t + dz * 0.1, 0.5, z1 + dz * t - dx * 0.1,
            ry, 1, rand(0.7, 1.1), 1, rand(-0.1, 0.1)
        )
    }
}

const makeInstanced = (geometry, material, matrices) =>
{
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length)
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
    return mesh
}
makeInstanced(postGeometry, fenceMaterial, postMatrices)
makeInstanced(picketGeometry, fenceMaterial, picketMatrices)
makeInstanced(railGeometry, fenceMaterial, railMatrices)

// Стовпи хвіртки трохи вищі
for(const x of [-1.0, 1.0, 2.25, 4.85])
{
    const post = makeBox(0.2, 1.7, 0.2, darkWoodMaterial, 1)
    post.position.set(x, 0.85, yardHalf)
    scene.add(post)
}

/**
 * Дерев'яні таблички з текстом (CanvasTexture)
 */
const makeSign = (text, { x, z, ry = 0, tilt = 0, small = false }) =>
{
    const cvs = document.createElement('canvas')
    cvs.width = 512
    cvs.height = 256
    const c = cvs.getContext('2d')
    c.drawImage(woodTex.color.image, 0, 0, 512, 256)
    c.fillStyle = 'rgba(0,0,0,0.25)'
    c.fillRect(0, 0, 512, 256)
    c.fillStyle = '#e8d9b8'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    const lines = text.split('\n')
    const fontSize = lines.length > 1 ? 68 : 84
    c.font = `bold ${fontSize}px Georgia, 'DejaVu Serif', serif`
    lines.forEach((line, i) =>
    {
        c.fillText(line, 256, 128 + (i - (lines.length - 1) / 2) * (fontSize + 8))
    })
    const texture = new THREE.CanvasTexture(cvs)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4

    const group = new THREE.Group()
    const postH = small ? 0.9 : 1.15
    const post = makeBox(0.1, postH, 0.1, darkWoodMaterial, 1)
    post.position.y = postH / 2
    const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.45, 0.05),
        [darkWoodMaterial, darkWoodMaterial, darkWoodMaterial, darkWoodMaterial, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }), darkWoodMaterial]
    )
    board.position.set(0, postH - 0.1, 0.07)
    board.rotation.z = tilt
    group.add(post, board)
    shadowAll(group)
    place(group, x, 0, z, ry)
    scene.add(group)
    return group
}
makeSign('ХВІРТКА\nЗАЧИНЕНА', { x: -1.8, z: 8.9, ry: 0.15, tilt: 0.06 })
makeSign('ГАРАЖ', { x: 2.7, z: 9.1, ry: -0.2, tilt: -0.05, small: true })
makeSign('ТУАЛЕТ', { x: 5.2, z: -4.9, ry: -0.9, tilt: 0.1, small: true })
makeSign('НЕ\nЗАХОДЬ', { x: -3.6, z: 4.4, ry: 0.6, tilt: -0.09 })
makeSign('ТУТ\nЖИВУТЬ\nПРИВИДИ', { x: 7.4, z: 5.6, ry: -0.5, tilt: 0.04 })

/**
 * Могили (два типи: плита та «арка») — випадкові місця, що не перетинаються з будівлями й доріжками
 */
const blockers = [
    // [x, z, радіус]
    [0, 0.5, 4.3], [3.55, 0, 3.0], [-6.3, -5.6, 2.6], [6.6, -6.4, 2.0], [0, 6.0, 1.3], [3.55, 6.3, 2.0]
]
const graves = new THREE.Group()
const gravePositions = []
const slabGeometry = new THREE.BoxGeometry(0.6, 0.8, 0.2)
const archBaseGeometry = new THREE.BoxGeometry(0.6, 0.55, 0.2)
const archTopGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14, 1, false, 0, Math.PI)
const crossVGeometry = new THREE.BoxGeometry(0.14, 0.95, 0.14)
const crossHGeometry = new THREE.BoxGeometry(0.55, 0.14, 0.14)

let tries = 0
while(gravePositions.length < 34 && tries < 3000)
{
    tries++
    const angle = random() * Math.PI * 2
    const radius = rand(4.6, 9.0)
    const x = Math.sin(angle) * radius
    const z = Math.cos(angle) * radius
    if(blockers.some(([bx, bz, br]) => Math.hypot(x - bx, z - bz) < br)) continue
    if(gravePositions.some(([gx, gz]) => Math.hypot(x - gx, z - gz) < 1.15)) continue
    gravePositions.push([x, z])

    const type = random()
    const grave = new THREE.Group()
    if(type < 0.45)
    {
        const slab = new THREE.Mesh(slabGeometry, graveMaterial)
        slab.position.y = 0.4
        grave.add(slab)
    }
    else if(type < 0.8)
    {
        const base = new THREE.Mesh(archBaseGeometry, graveMaterial)
        base.position.y = 0.275
        const top = new THREE.Mesh(archTopGeometry, graveMaterial)
        top.rotation.x = Math.PI / 2
        top.position.y = 0.55
        grave.add(base, top)
    }
    else
    {
        const v = new THREE.Mesh(crossVGeometry, graveMaterial)
        v.position.y = 0.45
        const h = new THREE.Mesh(crossHGeometry, graveMaterial)
        h.position.y = 0.62
        grave.add(v, h)
    }
    grave.position.set(x, 0, z)
    grave.rotation.y = (random() - 0.5) * 0.9 + Math.atan2(-x, -z) // обличчям до будинку з розкидом
    grave.rotation.z = (random() - 0.5) * 0.25
    grave.rotation.x = (random() - 0.5) * 0.18
    shadowAll(grave)
    graves.add(grave)
}
scene.add(graves)

/**
 * Мертві дерева
 */
const treeMaterial = makeWoodMaterial('#4a403b')
const makeDeadTree = (x, z, height, ry) =>
{
    const tree = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.24, height, 7), treeMaterial)
    trunk.position.y = height / 2
    tree.add(trunk)
    const branches = 5
    for(let i = 0; i < branches; i++)
    {
        const len = rand(1.0, 1.9)
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.07, len, 5), treeMaterial)
        const pivot = new THREE.Group()
        pivot.position.y = height * (0.45 + i * 0.11)
        pivot.rotation.y = i * 2.4 + rand(-0.4, 0.4)
        pivot.rotation.z = rand(0.7, 1.15)
        branch.position.y = len / 2
        pivot.add(branch)
        // маленька гілочка на кінці
        const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.035, len * 0.55, 4), treeMaterial)
        twig.position.set(0.0, len * 0.9, 0)
        twig.rotation.z = -rand(0.6, 1.0)
        twig.position.x = 0
        pivot.add(twig)
        tree.add(pivot)
    }
    shadowAll(tree)
    tree.position.set(x, 0, z)
    tree.rotation.y = ry
    scene.add(tree)
    return tree
}
makeDeadTree(-8.4, -8.2, 4.8, 0.2)
makeDeadTree(8.6, -9.0, 4.0, 1.4)
makeDeadTree(-8.8, 6.8, 3.6, 2.4)
makeDeadTree(8.8, 8.4, 4.4, 3.4)
makeDeadTree(-3.6, -9.2, 3.2, 4.2)

/**
 * Lights
 */
// Ambient light
const ambientLight = new THREE.AmbientLight(params.ambientColor, params.ambientIntensity)
scene.add(ambientLight)

// Directional light — «місячне світло»
const directionalLight = new THREE.DirectionalLight(params.moonColor, params.moonIntensity)
directionalLight.castShadow = true
directionalLight.shadow.mapSize.set(1024, 1024)
directionalLight.shadow.camera.top = 14
directionalLight.shadow.camera.right = 14
directionalLight.shadow.camera.bottom = -14
directionalLight.shadow.camera.left = -14
directionalLight.shadow.camera.near = 1
directionalLight.shadow.camera.far = 45
directionalLight.shadow.bias = -0.0008
scene.add(directionalLight)

// Світло над дверима — миготить
const doorLight = new THREE.PointLight(params.doorColor, params.doorIntensity, 0, 2)
doorLight.position.set(0, 2.55, 2.45)
house.add(doorLight)

// Світло-привиди
const ghostDefs = [
    { color: '#8800ff', speed: 0.5, radius: 6.2, wobble: 1 },
    { color: '#00e5ff', speed: -0.38, radius: 7.4, wobble: 1.15 },
    { color: '#ff3377', speed: 0.27, radius: 8.6, wobble: 0.85 }
]
const ghosts = ghostDefs.map((def) =>
{
    const light = new THREE.PointLight(def.color, params.ghostIntensity, 0, 2)
    light.castShadow = true
    light.shadow.mapSize.set(256, 256)
    light.shadow.camera.far = 16
    scene.add(light)

    // Видима «простирадлова» постать
    const material = new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.color,
        emissiveIntensity: 1.3,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false
    })
    const profile = [[0.0, 0.0], [0.34, 0.0], [0.4, 0.12], [0.34, 0.35], [0.28, 0.58], [0.24, 0.72], [0.15, 0.84], [0.0, 0.9]]
        .map(([r, y]) => new THREE.Vector2(r, y))
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 20), material)
    body.position.y = -0.3
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: '#000000' })
    const eyeGeometry = new THREE.SphereGeometry(0.045, 8, 8)
    const eyeL = new THREE.Mesh(eyeGeometry, eyeMaterial)
    eyeL.position.set(-0.1, 0.38, 0.21)
    eyeL.scale.set(1, 1.5, 0.6)
    const eyeR = eyeL.clone()
    eyeR.position.x = 0.1
    const mouth = new THREE.Mesh(eyeGeometry, eyeMaterial)
    mouth.position.set(0, 0.25, 0.23)
    mouth.scale.set(1.4, 2.2, 0.5)
    const visual = new THREE.Group()
    visual.add(body, eyeL, eyeR, mouth)
    visual.scale.setScalar(1.5)
    scene.add(visual)

    return { ...def, light, visual, material, angle: Math.random() * Math.PI * 2 }
})

/**
 * Shadows
 */
const applyShadows = (enabled) =>
{
    directionalLight.castShadow = enabled
    ghosts.forEach((g) => { g.light.castShadow = enabled })
}

/**
 * Sky
 */
const sky = new Sky()
sky.scale.set(100, 100, 100)
scene.add(sky)

const sunVector = new THREE.Vector3()
const updateSky = () =>
{
    const u = sky.material.uniforms
    u['turbidity'].value = params.turbidity
    u['rayleigh'].value = params.rayleigh
    u['mieCoefficient'].value = params.mieCoefficient
    u['mieDirectionalG'].value = params.mieDirectionalG
    // Кути → вектор: elevation над горизонтом, azimuth навколо осі Y
    const phi = THREE.MathUtils.degToRad(90 - params.sunElevation)
    const theta = THREE.MathUtils.degToRad(params.sunAzimuth)
    sunVector.setFromSphericalCoords(1, phi, theta)
    u['sunPosition'].value.copy(sunVector)
}
updateSky()

// Зірки: точки на півсфері; fog: false — туман їх не «з'їдає»
const starCount = 1400
const starPositions = new Float32Array(starCount * 3)
for(let i = 0; i < starCount; i++)
{
    const theta = random() * Math.PI * 2
    const elev = Math.asin(rand(-0.05, 1))
    const r = 46
    starPositions[i * 3] = Math.cos(elev) * Math.sin(theta) * r
    starPositions[i * 3 + 1] = Math.sin(elev) * r
    starPositions[i * 3 + 2] = Math.cos(elev) * Math.cos(theta) * r
}
const starGeometry = new THREE.BufferGeometry()
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
const starMaterial = new THREE.PointsMaterial({
    color: '#dfe9ff',
    size: 1.8,
    sizeAttenuation: false,
    transparent: true,
    opacity: params.stars,
    fog: false,
    depthWrite: false
})
const stars = new THREE.Points(starGeometry, starMaterial)
scene.add(stars)

// Місяць: диск + світіння (спрайт з радіальним градієнтом)
const moonGroup = new THREE.Group()
const moonDisc = new THREE.Mesh(
    new THREE.SphereGeometry(1.8, 24, 24),
    new THREE.MeshBasicMaterial({ color: '#f4f1d6', fog: false })
)
const glowCanvas = document.createElement('canvas')
glowCanvas.width = glowCanvas.height = 128
{
    const c = glowCanvas.getContext('2d')
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(210,225,255,0.65)')
    g.addColorStop(0.3, 'rgba(160,190,255,0.22)')
    g.addColorStop(1, 'rgba(120,160,255,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 128, 128)
}
const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(glowCanvas),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false
}))
moonGlow.scale.setScalar(13)
moonGroup.add(moonDisc, moonGlow)
scene.add(moonGroup)

const updateMoon = () =>
{
    const dir = new THREE.Vector3().setFromSphericalCoords(
        1,
        THREE.MathUtils.degToRad(90 - params.moonElevation),
        THREE.MathUtils.degToRad(params.moonAzimuth)
    )
    moonGroup.position.copy(dir).multiplyScalar(42)
    directionalLight.position.copy(dir).multiplyScalar(16)
}
updateMoon()

/**
 * Fog
 */
scene.fog = new THREE.FogExp2(params.fogColor, params.fogDensity)

/**
 * Sizes
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
}

window.addEventListener('resize', () =>
{
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight

    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()

    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

/**
 * Camera
 */
const camera = new THREE.PerspectiveCamera(70, sizes.width / sizes.height, 0.1, 100)
camera.position.set(6.5, 3.4, 12.5)
scene.add(camera)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.target.set(0.5, 1.6, 0)
controls.maxPolarAngle = Math.PI * 0.495 // не пускаємо камеру під землю
controls.minDistance = 2
controls.maxDistance = 24
controls.autoRotateSpeed = params.autoRotateSpeed

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({ canvas })
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

/**
 * GUI
 */
const refreshGui = () => gui.controllersRecursive().forEach((c) => c.updateDisplay())

// Небо
const skyFolder = gui.addFolder('Небо')
skyFolder.add(params, 'turbidity').min(0).max(20).step(0.1).name('Каламутність').onChange(updateSky)
skyFolder.add(params, 'rayleigh').min(0).max(4).step(0.001).name('Релей').onChange(updateSky)
skyFolder.add(params, 'mieCoefficient').min(0).max(0.2).step(0.001).name('Мі: коефіцієнт').onChange(updateSky)
skyFolder.add(params, 'mieDirectionalG').min(0).max(1).step(0.001).name('Мі: напрямок').onChange(updateSky)
skyFolder.add(params, 'sunElevation').min(-10).max(90).step(0.1).name('Сонце: висота °').onChange(updateSky)
skyFolder.add(params, 'sunAzimuth').min(0).max(360).step(0.1).name('Сонце: азимут °').onChange(updateSky)
skyFolder.add(params, 'stars').min(0).max(1).step(0.01).name('Зорі').onChange((v) => { starMaterial.opacity = v })

// Туман
const fogFolder = gui.addFolder('Туман')
fogFolder.add(params, 'fogDensity').min(0).max(0.25).step(0.001).name('Щільність').onChange((v) => { scene.fog.density = v })
fogFolder.addColor(params, 'fogColor').name('Колір').onChange((v) => { scene.fog.color.set(v) })

// Світло
const lightFolder = gui.addFolder('Світло')
lightFolder.addColor(params, 'ambientColor').name('Ambient: колір').onChange((v) => ambientLight.color.set(v))
lightFolder.add(params, 'ambientIntensity').min(0).max(2).step(0.001).name('Ambient: сила').onChange((v) => { ambientLight.intensity = v })
lightFolder.addColor(params, 'moonColor').name('Місяць: колір').onChange((v) => directionalLight.color.set(v))
lightFolder.add(params, 'moonIntensity').min(0).max(4).step(0.001).name('Місяць: сила').onChange((v) => { directionalLight.intensity = v })
lightFolder.add(params, 'moonElevation').min(2).max(85).step(0.5).name('Місяць: висота °').onChange(updateMoon)
lightFolder.add(params, 'moonAzimuth').min(0).max(360).step(1).name('Місяць: азимут °').onChange(updateMoon)
lightFolder.add(params, 'shadows').name('Тіні').onChange(applyShadows)

const doorFolder = gui.addFolder('Ліхтар біля дверей')
doorFolder.addColor(params, 'doorColor').name('Колір').onChange((v) => doorLight.color.set(v))
doorFolder.add(params, 'doorIntensity').min(0).max(15).step(0.01).name('Сила')
doorFolder.add(params, 'flickerSpeed').min(0).max(4).step(0.01).name('Швидкість миготіння')
doorFolder.add(params, 'flickerAmount').min(0).max(1).step(0.01).name('Глибина миготіння')
doorFolder.add(params, 'windowGlow').min(0).max(3).step(0.01).name('Світіння вікон')

// Привиди
const ghostFolder = gui.addFolder('Привиди')
ghostFolder.add(params, 'ghostSpeed').min(0).max(4).step(0.01).name('Загальна швидкість')
ghostFolder.add(params, 'ghostIntensity').min(0).max(20).step(0.1).name('Яскравість світла').onChange((v) =>
{
    ghosts.forEach((g) => { g.light.intensity = v })
})
ghostFolder.add(params, 'ghostVisible').name('Показати постаті').onChange((v) =>
{
    ghosts.forEach((g) => { g.visual.visible = v })
})
ghosts.forEach((g, i) =>
{
    const f = ghostFolder.addFolder(`Привид ${i + 1}`)
    f.close()
    f.addColor(g, 'color').name('Колір').onChange((v) =>
    {
        g.light.color.set(v)
        g.material.color.set(v)
        g.material.emissive.set(v)
    })
    f.add(g, 'speed').min(-2).max(2).step(0.01).name('Швидкість (мінус — назад)')
    f.add(g, 'radius').min(2.5).max(9).step(0.01).name('Радіус орбіти')
})

// Текстури
const textureFolder = gui.addFolder('Текстури: повторення')
textureFolder.close()
const repeatParams = { floor: 1, wall: 1, roof: 1, bush: 1, grave: 1 }
const repeatLabels = { floor: 'Земля', wall: 'Стіни', roof: 'Дах', bush: 'Кущі', grave: 'Могили' }
for(const key of Object.keys(repeatParams))
{
    textureFolder.add(repeatParams, key).min(0.25).max(4).step(0.01).name(`${repeatLabels[key]} ×`).onChange((v) => applyRepeat(key, v))
}
textureFolder.add(floorMaterial, 'displacementScale').min(0).max(1).step(0.001).name('Земля: рельєф')
textureFolder.add(floorMaterial, 'displacementBias').min(-1).max(1).step(0.001).name('Земля: зсув рельєфу')
textureFolder.add(doorMaterial, 'displacementScale').min(0).max(0.4).step(0.001).name('Двері: рельєф')
textureFolder.add(wallMaterial.normalScale, 'x').min(0).max(3).step(0.01).name('Стіни: сила нормалі').onChange((v) =>
{
    wallMaterial.normalScale.set(v, v)
    garageWallMaterial.normalScale.set(v, v)
})

// Анімація / камера
const animFolder = gui.addFolder('Анімація і камера')
animFolder.add(params, 'doorCreak').name('Двері туалету рипить')
animFolder.add(params, 'autoRotate').name('Автообертання камери').onChange((v) => { controls.autoRotate = v })
animFolder.add(params, 'autoRotateSpeed').min(-3).max(3).step(0.01).name('Швидкість обертання').onChange((v) => { controls.autoRotateSpeed = v })

// Звук
const soundFolder = gui.addFolder('Звук')
soundFolder.add(params, 'volume').min(0).max(1).step(0.01).name('Гучність').onChange(Sound.setMasterVolume)
soundFolder.add(params, 'wind').min(0).max(1).step(0.01).name('Вітер').onChange((v) => Sound.setLayer('wind', v))
soundFolder.add(params, 'drone').min(0).max(1).step(0.01).name('Гул').onChange((v) => Sound.setLayer('drone', v))
soundFolder.add(params, 'crickets').min(0).max(1).step(0.01).name('Цвіркуни').onChange((v) => Sound.setLayer('crickets', v))

// Пресети: Ніч / Сутінки / День
const presets = {
    'Ніч': () => Object.assign(params, {
        sunElevation: -2.2, turbidity: 10, rayleigh: 3, fogColor: '#04343f', fogDensity: 0.055,
        ambientIntensity: 0.275, moonIntensity: 1, stars: 0.9, ambientColor: '#86cdff', moonColor: '#86cdff'
    }),
    'Сутінки': () => Object.assign(params, {
        sunElevation: 3, turbidity: 12, rayleigh: 2.2, fogColor: '#2b3a56', fogDensity: 0.04,
        ambientIntensity: 0.55, moonIntensity: 1.4, stars: 0.35, ambientColor: '#ffb9a0', moonColor: '#ffc09a'
    }),
    'Пасмурний день': () => Object.assign(params, {
        sunElevation: 28, turbidity: 18, rayleigh: 1.2, fogColor: '#8f9ba3', fogDensity: 0.03,
        ambientIntensity: 1.1, moonIntensity: 2.2, stars: 0, ambientColor: '#ffffff', moonColor: '#fff4e0'
    })
}
const presetFolder = gui.addFolder('Пресети')
for(const name of Object.keys(presets))
{
    presetFolder.add({ go: () =>
    {
        presets[name]()
        updateSky()
        starMaterial.opacity = params.stars
        scene.fog.color.set(params.fogColor)
        scene.fog.density = params.fogDensity
        ambientLight.color.set(params.ambientColor)
        ambientLight.intensity = params.ambientIntensity
        directionalLight.color.set(params.moonColor)
        directionalLight.intensity = params.moonIntensity
        refreshGui()
    } }, 'go').name(name)
}
presetFolder.close()

/**
 * Звук: кнопка на екрані
 */
const soundBtn = document.getElementById('soundBtn')
soundBtn.addEventListener('click', () =>
{
    if(!Sound.audioState.started)
    {
        Sound.startAudio()
        soundBtn.textContent = '🔊 Вимкнути звук'
        return
    }
    const muted = !Sound.audioState.muted
    Sound.setMuted(muted)
    soundBtn.textContent = muted ? '🔇 Увімкнути звук' : '🔊 Вимкнути звук'
})

/**
 * Animate
 */
const timer = new Timer()
let flickerPhase = 0
let creakPrev = 0
const baseGlassEmissive = 1

const tick = () =>
{
    timer.update()
    const elapsedTime = timer.getElapsed()
    const deltaTime = Math.min(timer.getDelta(), 0.1)

    // --- Привиди: кут накопичується (а не множиться на час), тому повзунки швидкості не «стрибають»
    ghosts.forEach((g, i) =>
    {
        g.angle += deltaTime * g.speed * params.ghostSpeed
        const a = g.angle
        const r = g.radius
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r * (i === 2 ? 0.8 : 1)
        const y = 1.0 + Math.sin(a * 2.34 * g.wobble) * Math.sin(a * 3.45) * 0.55
        g.light.position.set(x, y + 0.4, z)
        g.visual.position.set(x, y, z)
        // дивимось у напрямку руху + легке погойдування
        const dir = Math.sign(g.speed || 1)
        g.visual.rotation.y = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir)
        g.visual.rotation.z = Math.sin(elapsedTime * 2 + i) * 0.08
        g.material.opacity = 0.42 + Math.sin(elapsedTime * 1.7 + i * 2) * 0.1
    })

    // --- Миготіння ліхтаря: «шум» із кількох синусоїд + періодичні короткі збої
    flickerPhase += deltaTime * params.flickerSpeed
    const t = flickerPhase
    const noise = 0.5 + 0.5 * Math.sin(t * 13.1) * Math.sin(t * 7.7 + 1.3) * Math.sin(t * 29.3 + 0.4)
    const dropout = Math.sin(t * 0.9) * Math.sin(t * 2.3 + 0.7) > 0.82 ? 0.08 : 1 // «блекаут»
    const flick = THREE.MathUtils.lerp(1, Math.min(1, noise * 1.4) * dropout, params.flickerAmount)
    doorLight.intensity = params.doorIntensity * flick
    lampBulbMaterial.emissiveIntensity = 0.2 + 2 * flick
    Sound.setBuzz(1 - flick)

    // Вікна світяться нерівно, як свічки
    glassMaterials.forEach((m, i) =>
    {
        const w = 0.8 + 0.2 * Math.sin(elapsedTime * (3 + i * 0.7) + i) * Math.sin(elapsedTime * 1.3 + i * 2)
        m.emissiveIntensity = baseGlassEmissive * params.windowGlow * w
    })

    // Гарбузи «дихають»
    pumpkins.forEach((p, i) =>
    {
        p.children[0].material.emissiveIntensity = 0.3 + 0.12 * Math.sin(elapsedTime * 2.2 + i)
    })

    // --- Двері туалету рипить
    const gust = Math.sin(elapsedTime * 0.7) * Math.sin(elapsedTime * 0.31 + 0.8)
    outhouseDoorPivot.rotation.y = params.doorCreak ? -(0.3 + 0.55 * Math.max(0, gust) + 0.08 * Math.sin(elapsedTime * 3)) : 0
    if(params.doorCreak && creakPrev < 0.35 && gust >= 0.35) Sound.creak()
    creakPrev = gust

    // Зірки ледь мерехтять
    starMaterial.size = 1.7 + Math.sin(elapsedTime * 3) * 0.12

    controls.update()
    renderer.render(scene, camera)
    window.requestAnimationFrame(tick)
}

tick()

// Для налагодження з консолі / автотестів
window.__scene = { scene, camera, controls, params }
