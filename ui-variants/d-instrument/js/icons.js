// SVG アイコン（自作・24 の格子・線 2）。絵文字や画像ファイルは使わない。
(function (GT) {
  "use strict";
  var P = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>',
    starFill: '<path fill="currentColor" d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    chev: '<path d="M9 5l7 7-7 7"/>',
    swap: '<path d="M7 4v15M7 19l-3-3M7 19l3-3M17 20V5M17 5l-3 3M17 5l3 3"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    gyro: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M8 14.5h2.5l1.5-1.5 1.5 1.5H16"/>',
    origin: '<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
    history: '<path d="M4 12a8 8 0 102.4-5.7L4 8.6"/><path d="M4 4v4.6h4.6M12 8v4l2.6 1.6"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c1.2-4 4-5.8 7.5-5.8s6.3 1.8 7.5 5.8"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.7 5.4 3.7 8.5s-1.2 5.9-3.7 8.5c-2.5-2.6-3.7-5.4-3.7-8.5S9.5 6.1 12 3.5z"/>',
    theme: '<circle cx="12" cy="12" r="8.5"/><path fill="currentColor" d="M12 3.5a8.5 8.5 0 010 17z"/>',
    external: '<path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 14v5.5H4.5V7H10"/>',
    yen: '<path d="M6.5 4l5.5 8 5.5-8M12 12v8M7.5 13.5h9M7.5 17h9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    rail: '<rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 11h12M9 20l1.5-3.5M15 20l-1.5-3.5"/><circle cx="9.3" cy="13.8" r=".6" fill="currentColor"/><circle cx="14.7" cy="13.8" r=".6" fill="currentColor"/>',
    subway: '<rect x="5.5" y="3.5" width="13" height="13" rx="6"/><path d="M5.5 10h13M8.5 20.5l2-4M15.5 20.5l-2-4"/>',
    tram: '<rect x="6" y="6" width="12" height="11" rx="2"/><path d="M9 3h6M12 3v3M6 12h12M9 20.5l1.5-3.5M15 20.5l-1.5-3.5"/>',
    bus: '<rect x="4.5" y="4" width="15" height="13" rx="2.5"/><path d="M4.5 11h15M7.5 20v-3M16.5 20v-3"/><circle cx="8" cy="14" r=".6" fill="currentColor"/><circle cx="16" cy="14" r=".6" fill="currentColor"/>',
    ferry: '<path d="M3 15l2 4h14l2-4zM6 15V9.5h12V15M9.5 9.5V6.5h5v3"/>',
    air: '<path d="M10.5 20l1.5-6.5L5 15l-1-1.5 8-4.5V5a1.5 1.5 0 013 0v4l5.5 4.5-1 1.5-5-1.5L15 20l-2.2.8z"/>',
    cable: '<path d="M3 5l18 5M12 7.5V10"/><rect x="7.5" y="10" width="9" height="8" rx="2"/>',
    walk: '<circle cx="13" cy="4.8" r="1.8"/><path d="M10 21l2-6 2.5 2.5V21M9 11.5l2.5-3.5 3 1.5 2 3M11.5 8l-1.5 6.5"/>',
    other: '<circle cx="12" cy="12" r="7.5"/>',
    // 確からしさ：確＝塗りの丸＋チェック、推＝半分塗りの三角、不明＝破線の丸＋？（形でも区別）
    confConfirmed: '<circle cx="12" cy="12" r="8.5" fill="currentColor" stroke="none"/><path d="M8 12.3l2.7 2.7L16.2 9.5" stroke="var(--on-ink)" />',
    confInferred: '<path d="M12 3.8l8.6 15.2H3.4z"/><path d="M12 3.8L3.4 19H12z" fill="currentColor"/>',
    confUnknown: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.4"/><path d="M9.7 9.6a2.4 2.4 0 114 1.8c-.9.7-1.7 1.2-1.7 2.4M12 16.8v.1"/>',
    login: '<path d="M10 4.5H5.5v15H10M14 8l4 4-4 4M18 12H9"/>',
    doc: '<path d="M6.5 3.5h7.5l4 4v13h-11.5zM14 3.5v4h4M9.5 12h5M9.5 15.5h5"/>'
  };
  GT.icon = function (name, cls, label) {
    var a = label ? ' role="img" aria-label="' + label + '"' : ' aria-hidden="true"';
    return '<svg class="ic ' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"' + a + ">" + (P[name] || P.other) + "</svg>";
  };
})(window.GT = window.GT || {});
