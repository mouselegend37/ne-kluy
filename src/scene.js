/**
 * Фоновая сцена: «волна» из частиц.
 *
 * Задачи: не мешать чтению, не жечь батарею, не падать без WebGL.
 * Поэтому: один вызов рендера без анимации при prefers-reduced-motion,
 * пауза при уходе со вкладки и при прокрутке за пределы обложки,
 * потолок DPR 2, ~15 тысяч точек вместо тяжёлой геометрии.
 */
import * as THREE from "three";

const TEAL = new THREE.Color("#37e0bd");
const VIOLET = new THREE.Color("#9b8cff");
const AMBER = new THREE.Color("#ffb648");

function dotTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function initScene(canvas) {
  if (!canvas) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  } catch {
    canvas.style.display = "none"; // без WebGL обложка остаётся на градиенте
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(0, -2.2, 9);
  camera.lookAt(0, 1.4, 0);

  const COLS = 172;
  const ROWS = 92;
  const SPAN_X = 20;
  const SPAN_Y = 13;

  const count = COLS * ROWS;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const base = new Float32Array(count * 2);

  let pointer = 0;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const x = (col / (COLS - 1) - 0.5) * SPAN_X;
      const y = (row / (ROWS - 1) - 0.5) * SPAN_Y;
      base[pointer * 2] = x;
      base[pointer * 2 + 1] = y;
      positions[pointer * 3] = x;
      positions[pointer * 3 + 1] = y;
      positions[pointer * 3 + 2] = 0;
      pointer += 1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.1,
    map: dotTexture(),
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    opacity: 0.95,
  });

  const cloud = new THREE.Points(geometry, material);
  scene.add(cloud);

  /* ── «Река денег»: частицы летят от клиента (слева) к мошеннику (справа).
     Лежат внутри cloud, поэтому наследуют его поворот и выглядят как поток по волне. */
  const MONEY = 420;
  const moneyPositions = new Float32Array(MONEY * 3);
  const moneyColors = new Float32Array(MONEY * 3);
  const moneySeed = new Float32Array(MONEY * 2);
  for (let i = 0; i < MONEY; i += 1) {
    moneySeed[i * 2] = Math.random();
    moneySeed[i * 2 + 1] = Math.random();
  }

  const moneyGeometry = new THREE.BufferGeometry();
  moneyGeometry.setAttribute("position", new THREE.BufferAttribute(moneyPositions, 3));
  moneyGeometry.setAttribute("color", new THREE.BufferAttribute(moneyColors, 3));

  const moneyMaterial = new THREE.PointsMaterial({
    size: 0.085,
    map: material.map,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    opacity: 0.42,
  });

  const money = new THREE.Points(moneyGeometry, moneyMaterial);
  cloud.add(money);

  const gold = new THREE.Color("#ffc45e");
  const updateMoney = (time) => {
    const positionAttr = moneyGeometry.getAttribute("position");
    const colorAttr = moneyGeometry.getAttribute("color");
    for (let i = 0; i < MONEY; i += 1) {
      const phase = moneySeed[i * 2];
      const drift = moneySeed[i * 2 + 1];
      const speed = 0.05 + drift * 0.045;
      const t = (time * speed + phase) % 1;
      const x = -9.6 + t * 19.2;
      // поток держим ниже: он фон, а не участник композиции
      const y = -1.55 + (drift - 0.5) * 0.55;
      const z =
        Math.sin(x * 0.55 + time * 0.85) * 0.3 +
        Math.sin(y * 0.85 - time * 0.6) * 0.18 +
        0.16;
      positionAttr.setXYZ(i, x, y, z);
      // Плавное появление и исчезновение на краях: поток втекает и утекает.
      const fade = Math.min(1, Math.sin(t * Math.PI) * 1.7) * (0.35 + drift * 0.35);
      colorAttr.setXYZ(i, gold.r * fade, gold.g * fade, gold.b * fade);
    }
    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  };

  const pointerTarget = { x: 0, y: 0 };
  const pointerCurrent = { x: 0, y: 0 };
  let scrollProgress = 0;
  let visible = true;
  let frame = 0;

  const readScroll = () => {
    const height = window.innerHeight || 1;
    scrollProgress = Math.min(1, Math.max(0, window.scrollY / height));
  };

  const resize = () => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    readScroll();
  };

  const colorAt = new THREE.Color();
  const updatePositions = (time) => {
    const amp = 0.55 + scrollProgress * 1.9;
    const attr = geometry.getAttribute("position");
    const colorAttr = geometry.getAttribute("color");
    for (let i = 0; i < count; i += 1) {
      const x = base[i * 2];
      const y = base[i * 2 + 1];
      const wave =
        Math.sin(x * 0.55 + time * 0.85) * 0.5 +
        Math.sin(y * 0.85 - time * 0.6) * 0.32 +
        Math.sin((x + y) * 0.34 + time * 0.45) * 0.3 +
        Math.sin(Math.hypot(x * 0.5, y * 0.7) - time * 0.5) * 0.22;
      const z = wave * amp;
      attr.setZ(i, z);

      // Ближе к гребню — холоднее и ярче, во впадине — теплее и тише.
      const t = THREE.MathUtils.clamp((z / amp + 1) / 2, 0, 1);
      colorAt.copy(TEAL).lerp(VIOLET, t * 0.75);
      if (t < 0.22) colorAt.lerp(AMBER, (0.22 - t) * 2.2);
      const dim = 0.42 + t * 0.58;
      colorAttr.setXYZ(i, colorAt.r * dim, colorAt.g * dim, colorAt.b * dim);
    }
    attr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  };

  const render = (time) => {
    pointerCurrent.x += (pointerTarget.x - pointerCurrent.x) * 0.05;
    pointerCurrent.y += (pointerTarget.y - pointerCurrent.y) * 0.05;
    cloud.rotation.z = pointerCurrent.x * 0.05;
    cloud.rotation.x = -0.52 + pointerCurrent.y * 0.06 - scrollProgress * 0.22;
    cloud.position.y = -0.4 - scrollProgress * 1.2;
    updatePositions(time);
    updateMoney(time);
    renderer.render(scene, camera);
  };

  const loop = () => {
    if (visible && !document.hidden) {
      frame = requestAnimationFrame(loop);
      render(performance.now() * 0.001);
    }
  };

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener(
    "pointermove",
    (event) => {
      pointerTarget.x = (event.clientX / window.innerWidth - 0.5) * 2;
      pointerTarget.y = (event.clientY / window.innerHeight - 0.5) * 2;
    },
    { passive: true },
  );
  window.addEventListener("scroll", readScroll, { passive: true });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !reduced) loop();
      },
      { threshold: 0.02 },
    ).observe(canvas);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !reduced) loop();
  });

  resize();
  render(0);

  if (!reduced) {
    loop();
  } else {
    // Статичный кадр: волна видна, движения нет.
    updatePositions(0.6);
    renderer.render(scene, camera);
  }

  return () => {
    cancelAnimationFrame(frame);
    geometry.dispose();
    moneyGeometry.dispose();
    moneyMaterial.dispose();
    material.map?.dispose();
    material.dispose();
    renderer.dispose();
  };
}
