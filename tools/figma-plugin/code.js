/* Мост между Figma и ассистентом.
 *
 * Экспорт: выделение → JSON (дерево, координаты, размеры, цвета, текст, шрифты).
 * Импорт:  JSON → новые фреймы на текущей странице.
 *
 * Плагин локальный (development), в Figma Community не публикуется и работает
 * бесплатно на бесплатном тарифе.
 */

figma.showUI(__html__, { width: 360, height: 460, themeColors: true });

// ── цвет ────────────────────────────────────────────────────────────

function toHex(color) {
  const channel = (value) => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function paintToCss(paints) {
  const solid = (paints || []).find((paint) => paint.type === "SOLID" && paint.visible !== false);
  if (!solid) return null;
  const hex = toHex(solid.color);
  return solid.opacity === undefined || solid.opacity === 1 ? hex.toUpperCase() : `${hex.toUpperCase()}${Math.round(solid.opacity * 255).toString(16).padStart(2, "0").toUpperCase()}`;
}

function hexToPaint(hex) {
  const clean = String(hex || "").replace("#", "");
  if (clean.length !== 6) return [];
  return [{
    type: "SOLID",
    color: {
      r: parseInt(clean.slice(0, 2), 16) / 255,
      g: parseInt(clean.slice(2, 4), 16) / 255,
      b: parseInt(clean.slice(4, 6), 16) / 255,
    },
  }];
}

// ── экспорт ─────────────────────────────────────────────────────────

function serializeNode(node) {
  const box = node.absoluteBoundingBox || { x: 0, y: 0, width: node.width, height: node.height };
  const data = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: Math.round(box.x * 10) / 10,
    y: Math.round(box.y * 10) / 10,
    width: Math.round(box.width * 10) / 10,
    height: Math.round(box.height * 10) / 10,
  };

  if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") {
    data.layout = node.layoutMode && node.layoutMode !== "NONE" ? node.layoutMode : "free";
    data.gap = node.itemSpacing;
    data.padding = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft];
  }
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") data.radius = node.cornerRadius;
  if ("opacity" in node && node.opacity !== 1) data.opacity = Math.round(node.opacity * 100) / 100;
  const fill = paintToCss(node.fills);
  if (fill) data.fill = fill;
  const stroke = paintToCss(node.strokes);
  if (stroke && node.strokeWeight) {
    data.stroke = stroke;
    data.strokeWidth = node.strokeWeight;
  }

  if (node.type === "TEXT") {
    data.text = node.characters;
    const style = node.fontName && node.fontName !== figma.mixed ? node.fontName : null;
    data.font = style ? { family: style.family, style: style.style } : null;
    data.fontSize = node.fontSize === figma.mixed ? null : node.fontSize;
    data.lineHeight = node.lineHeight !== figma.mixed && node.lineHeight.unit === "PIXELS" ? node.lineHeight.value : null;
    data.align = node.textAlignHorizontal;
    data.color = data.fill || "#FFFFFF";
  }

  if ("children" in node && node.children) {
    data.children = node.children.map(serializeNode);
  }
  return data;
}

function exportSelection() {
  const selection = figma.currentPage.selection;
  if (!selection.length) {
    figma.ui.postMessage({ type: "status", text: "Ничего не выделено: выделите фрейм или слой." });
    return;
  }
  const payload = {
    file: figma.root.name,
    page: figma.currentPage.name,
    generated: new Date().toISOString(),
    nodes: selection.map(serializeNode),
  };
  figma.ui.postMessage({ type: "json", text: JSON.stringify(payload, null, 2) });
  figma.ui.postMessage({ type: "status", text: `Экспортировано слоёв: ${selection.length}` });
}

// ── импорт ──────────────────────────────────────────────────────────

async function ensureFont(spec) {
  const family = (spec.font && spec.font.family) || "Inter";
  const style = (spec.font && spec.font.style) || "Regular";
  const font = { family, style };
  try {
    await figma.loadFontAsync(font);
    return font;
  } catch (error) {
    const fallback = { family: "Inter", style: "Regular" };
    await figma.loadFontAsync(fallback);
    return fallback;
  }
}

async function buildNode(spec, parent) {
  let node = null;

  if (spec.type === "TEXT" && spec.text) {
    node = figma.createText();
    node.fontName = await ensureFont(spec);
    node.characters = spec.text;
    if (spec.fontSize) node.fontSize = spec.fontSize;
    if (spec.lineHeight) node.lineHeight = { unit: "PIXELS", value: spec.lineHeight };
    node.fills = hexToPaint(spec.color || spec.fill || "#FFFFFF");
    if (spec.align) node.textAlignHorizontal = spec.align;
    node.textAutoResize = "HEIGHT";
    node.resize(Math.max(8, spec.width), Math.max(8, spec.height));
  } else if (spec.type === "FRAME" || spec.children || spec.layout) {
    node = figma.createFrame();
    node.fills = hexToPaint(spec.fill || "#00000000");
    node.resize(Math.max(1, spec.width), Math.max(1, spec.height));
    if (spec.radius) node.cornerRadius = spec.radius;
    if (spec.stroke && spec.strokeWidth) {
      node.strokes = hexToPaint(spec.stroke);
      node.strokeWeight = spec.strokeWidth;
      node.strokeAlign = "INSIDE";
    }
    if (spec.layout && spec.layout !== "free") {
      node.layoutMode = spec.layout;
      if (spec.gap !== undefined) node.itemSpacing = spec.gap;
      if (spec.padding) {
        node.paddingTop = spec.padding[0];
        node.paddingRight = spec.padding[1];
        node.paddingBottom = spec.padding[2];
        node.paddingLeft = spec.padding[3];
      }
    }
  } else {
    node = figma.createRectangle();
    node.fills = hexToPaint(spec.fill || "#FFFFFF");
    node.resize(Math.max(1, spec.width), Math.max(1, spec.height));
    if (spec.radius) node.cornerRadius = spec.radius;
    if (spec.stroke && spec.strokeWidth) {
      node.strokes = hexToPaint(spec.stroke);
      node.strokeWeight = spec.strokeWidth;
    }
  }

  node.name = spec.name || spec.type || "layer";
  if (spec.opacity !== undefined) node.opacity = spec.opacity;
  parent.appendChild(node);
  if (!spec.children || !spec.children.length) {
    node.x = spec.x || 0;
    node.y = spec.y || 0;
    return node;
  }

  // Дети — от левого верхнего края родителя
  for (const child of spec.children) {
    const built = await buildNode(child, node);
    built.x = child.x - spec.x;
    built.y = child.y - spec.y;
  }
  node.x = spec.x || 0;
  node.y = spec.y || 0;
  return node;
}

async function importJson(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    figma.ui.postMessage({ type: "status", text: "Это не JSON: " + error.message });
    return;
  }
  const nodes = payload.nodes || (Array.isArray(payload) ? payload : [payload]);
  const created = [];
  for (const spec of nodes) {
    created.push(await buildNode(spec, figma.currentPage));
  }
  figma.currentPage.selection = created;
  figma.viewport.scrollAndZoomIntoView(created);
  figma.ui.postMessage({ type: "status", text: `Создано фреймов: ${created.length}` });
}

// ── канал с интерфейсом ─────────────────────────────────────────────

figma.ui.onmessage = (message) => {
  if (message.type === "export") exportSelection();
  if (message.type === "import") importJson(message.text).catch((error) => {
    figma.ui.postMessage({ type: "status", text: "Ошибка импорта: " + error.message });
  });
  if (message.type === "close") figma.closePlugin();
};
