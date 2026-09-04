// 字幕拖動的位置計算。純函式。
// 位置模型：offsetX = 相對容器水平中心的 px（0 = 置中），bottom = 距容器底部 px。

const DEFAULT = { offsetX: 0, bottom: 80 };

function num(v, dflt) {
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}

/**
 * @param {{offsetX:number,bottom:number}|null} pos
 * @param {{width:number,height:number,boxWidth:number,boxHeight:number}} bounds 容器與字幕框尺寸
 */
export function clampPosition(pos, bounds) {
  let offsetX = num(pos?.offsetX, DEFAULT.offsetX);
  let bottom = num(pos?.bottom, DEFAULT.bottom);
  const width = num(bounds?.width, 0);
  const height = num(bounds?.height, 0);
  const boxW = num(bounds?.boxWidth, 0);
  const boxH = num(bounds?.boxHeight, 0);

  const halfRange = (width - boxW) / 2;
  offsetX = halfRange <= 0 ? 0 : Math.max(-halfRange, Math.min(halfRange, offsetX));

  const maxBottom = Math.max(0, height - boxH);
  bottom = Math.max(0, Math.min(maxBottom, bottom));
  return { offsetX, bottom };
}

/** 依滑鼠位移更新位置（y 往下 → bottom 變小），結果經 clamp。 */
export function applyDrag(startPos, startPointer, curPointer, bounds) {
  const dx = curPointer.x - startPointer.x;
  const dy = curPointer.y - startPointer.y;
  return clampPosition({ offsetX: startPos.offsetX + dx, bottom: startPos.bottom - dy }, bounds);
}
