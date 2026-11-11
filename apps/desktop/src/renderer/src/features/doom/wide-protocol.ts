export function renderSize(width: number, height: number) {
  const w = Math.max(1, width),
    h = Math.max(1, height);
  const scale = Math.min(1, 1600 / w, 1000 / h);
  return {
    width: Math.max(2, Math.round((w * scale) / 2) * 2),
    height: Math.max(2, Math.round((h * scale) / 2) * 2),
  };
}

export function keyboardInput(value: number) {
  if (value >= 65 && value <= 90)
    return {
      code: `Key${String.fromCharCode(value)}`,
      key: String.fromCharCode(value).toLowerCase(),
      keyCode: value,
      which: value,
      location: 0,
    };
  if (value >= 48 && value <= 57)
    return {
      code: `Digit${String.fromCharCode(value)}`,
      key: String.fromCharCode(value),
      keyCode: value,
      which: value,
      location: 0,
    };
  const keys: Record<number, [string, string, number, number?]> = {
    32: ["Space", " ", 32],
    256: ["Escape", "Escape", 27],
    257: ["Enter", "Enter", 13],
    258: ["Tab", "Tab", 9],
    259: ["Backspace", "Backspace", 8],
    340: ["ShiftLeft", "Shift", 16, 1],
    344: ["ShiftRight", "Shift", 16, 2],
    341: ["ControlLeft", "Control", 17, 1],
    345: ["ControlRight", "Control", 17, 2],
    342: ["AltLeft", "Alt", 18, 1],
    346: ["AltRight", "Alt", 18, 2],
  };
  const entry =
    keys[value] ??
    (value >= 290 && value <= 301
      ? ([`F${value - 289}`, `F${value - 289}`, value - 178] as [string, string, number])
      : null);
  if (!entry) return null;
  const [code, key, keyCode, location = 0] = entry;
  return { code, key, keyCode, which: keyCode, location };
}

export function startupArguments(size: { width: number; height: number }) {
  return [
    "-iwad",
    "/DOOM1.WAD",
    "-config",
    "/nexo.ini",
    "-nosound",
    "-nomusic",
    "-skill",
    "3",
    "+vid_rendermode",
    "4",
    "+vid_preferbackend",
    "1",
    "+vid_fullscreen",
    "0",
    "+vid_defwidth",
    String(size.width),
    "+vid_defheight",
    String(size.height),
    "+win_w",
    String(size.width),
    "+win_h",
    String(size.height),
    "+vid_aspect",
    "0",
    "+vid_scalemode",
    "0",
    "+vid_vsync",
    "0",
    "+vid_maxfps",
    "60",
    "+cl_capfps",
    "0",
    "+gl_texture_filter",
    "0",
    "+uiscale",
    "0",
    "+st_scale",
    "0",
    "+screenblocks",
    "11",
    "+freelook",
    "1",
    "+m_pitch",
    "1",
    "+m_forward",
    "0",
    "+m_side",
    "0",
    "+sensitivity",
    "1.5",
    "+crosshair",
    "1",
    "+show_messages",
    "0",
    "+map",
    "e1m1",
  ];
}
