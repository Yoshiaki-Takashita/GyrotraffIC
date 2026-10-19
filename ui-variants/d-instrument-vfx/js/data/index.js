// どのデータ層を使うかを決める所。API 版ができたら GT.providers.api を足し、ここで切り替える。
(function (GT) {
  "use strict";
  GT.screens = GT.screens || {};
  GT.data = GT.providers[(window.GT_CONFIG && window.GT_CONFIG.provider) || "static"];
})(window.GT = window.GT || {});
