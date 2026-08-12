'use strict';

var kolmafia = require('kolmafia');

function _arrayLikeToArray(r, a) {
  (null == a || a > r.length) && (a = r.length);
  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
  return n;
}
function _arrayWithHoles(r) {
  if (Array.isArray(r)) return r;
}
function _iterableToArrayLimit(r, l) {
  var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
  if (null != t) {
    var e,
      n,
      i,
      u,
      a = [],
      f = true,
      o = false;
    try {
      if (i = (t = t.call(r)).next, 0 === l) ; else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
    } catch (r) {
      o = true, n = r;
    } finally {
      try {
        if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
      } finally {
        if (o) throw n;
      }
    }
    return a;
  }
}
function _nonIterableRest() {
  throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _slicedToArray(r, e) {
  return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
}
function _unsupportedIterableToArray(r, a) {
  if (r) {
    if ("string" == typeof r) return _arrayLikeToArray(r, a);
    var t = {}.toString.call(r).slice(8, -1);
    return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
  }
}

// NC 1562 "Time is a Möbius Strip" (Möbius ring, fires only while worn): option
// numbers rotate between visits, so match by button text (loopstar's approach).
// Always skip — free, no turn, no Paradoxicity drift (user decision, 2026-08-12).
var MOBIUS_STRIP_CHOICE = 1562;
var SKIP_TEXT = "I'm not messing with the timeline!";
function main(choice, page) {
  if (choice !== MOBIUS_STRIP_CHOICE) return;
  var options = kolmafia.availableChoiceOptions();
  for (var _i = 0, _Object$entries = Object.entries(options); _i < _Object$entries.length; _i++) {
    var _Object$entries$_i = _slicedToArray(_Object$entries[_i], 2),
      num = _Object$entries$_i[0],
      text = _Object$entries$_i[1];
    if (text === SKIP_TEXT) {
      kolmafia.runChoice(Number(num));
      return;
    }
  }
  // Leave it unhandled so mafia's abort surfaces the problem rather than
  // silently gambling with the timeline (spec: error handling).
  kolmafia.print("pearlo-choice: choice 1562 has no \"".concat(SKIP_TEXT, "\" option \u2014 not answering it."), "red");
}

exports.main = main;
