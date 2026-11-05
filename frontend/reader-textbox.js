export const TEXTBOX_FONT_FAMILY = '"Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';
export const TEXTBOX_COLORS = { black: "#1f2937", blue: "#1d4ed8", green: "#166534", red: "#b91c1c" };

const PADDING = 4;
const LINE_HEIGHT = 1.4;
let measurementContext = null;

function getMeasurementContext() {
  if (!measurementContext) measurementContext = document.createElement("canvas").getContext("2d");
  return measurementContext;
}

function wrapParagraph(paragraph, availableWidth, measure) {
  const characters = Array.from(paragraph);
  if (!characters.length) return [""];
  const lines = [];
  let offset = 0;
  while (offset < characters.length) {
    let low = 1;
    let high = characters.length - offset;
    let fit = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = characters.slice(offset, offset + middle).join("");
      if (measure(candidate) <= availableWidth) {
        fit = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    fit = Math.max(1, fit);
    const end = offset + fit;
    if (end >= characters.length) {
      lines.push(characters.slice(offset).join(""));
      break;
    }
    let breakAt = -1;
    for (let index = end - 1; index > offset; index -= 1) {
      if (/\s/u.test(characters[index])) {
        breakAt = index;
        break;
      }
    }
    if (breakAt > offset) {
      lines.push(characters.slice(offset, breakAt).join("").trimEnd());
      offset = breakAt + 1;
      while (offset < characters.length && /\s/u.test(characters[offset])) offset += 1;
    } else {
      lines.push(characters.slice(offset, end).join(""));
      offset = end;
    }
  }
  return lines;
}

export function layoutTextbox(text, fontSize, width, height) {
  const context = getMeasurementContext();
  context.font = `${fontSize}px ${TEXTBOX_FONT_FAMILY}`;
  const measure = (value) => context.measureText(value).width;
  const availableWidth = Math.max(0, width - 2 * PADDING);
  const normalized = String(text || "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  const lines = normalized.split("\n").flatMap((paragraph) => wrapParagraph(paragraph, availableWidth, measure));
  const lineHeight = LINE_HEIGHT * fontSize;
  const firstBaseline = PADDING + fontSize;
  const horizontalOverflow = lines.some((line) => measure(line) > availableWidth + 0.01);
  const verticalOverflow = firstBaseline + Math.max(0, lines.length - 1) * lineHeight > height - PADDING + 0.01;
  const inkOverflow = lines.some((line, index) => {
    const metrics = context.measureText(line);
    const baseline = firstBaseline + index * lineHeight;
    const bound = (side) => {
      const actual = metrics[`actualBoundingBox${side}`];
      if (Number.isFinite(actual)) return actual;
      if (side === "Left") return 0;
      if (side === "Right") return Number.isFinite(metrics.width) ? metrics.width : availableWidth + 1;
      const fontBound = metrics[`fontBoundingBox${side}`];
      if (Number.isFinite(fontBound)) return fontBound;
      return side === "Ascent" ? fontSize : fontSize * 0.25;
    };
    const left = PADDING - bound("Left");
    const right = PADDING + bound("Right");
    const top = baseline - bound("Ascent");
    const bottom = baseline + bound("Descent");
    return left < -0.01 || right > width + 0.01 || top < -0.01 || bottom > height + 0.01;
  });
  return {
    lines,
    fontSize,
    lineHeight,
    padding: PADDING,
    width,
    height,
    overflow: horizontalOverflow || verticalOverflow || inkOverflow
  };
}

export function drawTextboxCanvas(context, layout, x, y, scale, color) {
  context.save();
  context.beginPath();
  context.rect(x, y, layout.width * scale, layout.height * scale);
  context.clip();
  context.fillStyle = color;
  context.font = `${layout.fontSize * scale}px ${TEXTBOX_FONT_FAMILY}`;
  context.textBaseline = "alphabetic";
  for (let index = 0; index < layout.lines.length; index += 1) {
    const baseline = y + (layout.padding + layout.fontSize + index * layout.lineHeight) * scale;
    context.fillText(layout.lines[index], x + layout.padding * scale, baseline);
  }
  context.restore();
}
