(function (global) {
  const symbols = {
  "\\Alpha": "\u0391",
  "\\Beta": "\u0392",
  "\\Gamma": "\u0393",
  "\\Delta": "\u0394",
  "\\Epsilon": "\u0395",
  "\\Zeta": "\u0396",
  "\\Eta": "\u0397",
  "\\Theta": "\u0398",
  "\\Iota": "I",
  "\\Kappa": "\u039A",
  "\\Lambda": "\u039B",
  "\\Mu": "\u039C",
  "\\Nu": "\u039D",
  "\\Xi": "\u039E",
  "\\Omicron": "\u039F",
  "\\Pi": "\u03A0",
  "\\Rho": "\u03A1",
  "\\Sigma": "\u03A3",
  "\\Tau": "\u03A4",
  "\\Upsilon": "\u03A5",
  "\\Phi": "\u03A6",
  "\\Chi": "\u03A7",
  "\\Psi": "\u03A8",
  "\\Omega": "\u03A9",
  "\\alpha": "\u03B1",
  "\\beta": "\u03B2",
  "\\gamma": "\u03B3",
  "\\delta": "\u03B4",
  "\\epsilon": "\u03F5",
  "\\zeta": "\u03B6",
  "\\eta": "\u03B7",
  "\\theta": "\u03B8",
  "\\iota": "\u03B9",
  "\\kappa": "\u03BA",
  "\\lambda": "\u03BB",
  "\\mu": "\u03BC",
  "\\nu": "\u03BD",
  "\\xi": "\u03BE",
  "\\omicron": "\u03BF",
  "\\pi": "\u03C0",
  "\\rho": "\u03C1",
  "\\sigma": "\u03C3",
  "\\tau": "\u03C4",
  "\\upsilon": "\u03C5",
  "\\phi": "\u03D5",
  "\\chi": "\u03C7",
  "\\psi": "\u03C8",
  "\\omega": "\u03C9",
  "\\varepsilon": "\u03B5",
  "\\varnothing": "\u2205",
  "\\varkappa": "\u03F0",
  "\\varphi": "\u03C6",
  "\\varpi": "\u03D6",
  "\\varrho": "\u03F1",
  "\\varsigma": "\u03C2",
  "\\vartheta": "\u03D1",
  "\\neq": "\u2260",
  "\\equiv": "\u2261",
  "\\not\\equiv": "\u2262",
  "\\leq": "\u2264",
  "\\geq": "\u2265",
  "\\leqq": "\u2266",
  "\\geqq": "\u2267",
  "\\lneqq": "\u2268",
  "\\gneqq": "\u2269",
  "\\leqslant": "\u2A7D",
  "\\geqslant": "\u2A7E",
  "\\ll": "\u226A",
  "\\gg": "\u226B",
  "\\nless": "\u226E",
  "\\ngtr": "\u226F",
  "\\nleq": "\u2270",
  "\\ngeq": "\u2271",
  "\\lessequivlnt": "\u2272",
  "\\greaterequivlnt": "\u2273",
  "\\prec": "\u227A",
  "\\succ": "\u227B",
  "\\preccurlyeq": "\u227C",
  "\\succcurlyeq": "\u227D",
  "\\precapprox": "\u227E",
  "\\succapprox": "\u227F",
  "\\nprec": "\u2280",
  "\\nsucc": "\u2281",
  "\\sim": "\u223C",
  "\\not\\sim": "\u2241",
  "\\simeq": "\u2243",
  "\\not\\simeq": "\u2244",
  "\\backsim": "\u223D",
  "\\lazysinv": "\u223E",
  "\\wr": "\u2240",
  "\\cong": "\u2245",
  "\\not\\cong": "\u2247",
  "\\approx": "\u2248",
  "\\not\\approx": "\u2249",
  "\\approxeq": "\u224A",
  "\\approxnotequal": "\u2246",
  "\\tildetrpl": "\u224B",
  "\\allequal": "\u224C",
  "\\asymp": "\u224D",
  "\\doteq": "\u2250",
  "\\doteqdot": "\u2251",
  "\\lneq": "\u2A87",
  "\\gneq": "\u2A88",
  "\\preceq": "\u2AAF",
  "\\succeq": "\u2AB0",
  "\\precneqq": "\u2AB5",
  "\\succneqq": "\u2AB6",
  "\\emptyset": "\u2205",
  "\\in": "\u2208",
  "\\notin": "\u2209",
  "\\not\\in": "\u2209",
  "\\ni": "\u220B",
  "\\not\\ni": "\u220C",
  "\\subset": "\u2282",
  "\\subseteq": "\u2286",
  "\\not\\subset": "\u2284",
  "\\not\\subseteq": "\u2288",
  "\\supset": "\u2283",
  "\\supseteq": "\u2287",
  "\\not\\supset": "\u2285",
  "\\not\\supseteq": "\u2289",
  "\\subsetneq": "\u228A",
  "\\supsetneq": "\u228B",
  "\\exists": "\u2203",
  "\\nexists": "\u2204",
  "\\not\\exists": "\u2204",
  "\\forall": "\u2200",
  "\\aleph": "\u2135",
  "\\beth": "\u2136",
  "\\neg": "\u00AC",
  "\\wedge": "\u2227",
  "\\vee": "\u2228",
  "\\veebar": "\u22BB",
  "\\land": "\u2227",
  "\\lor": "\u2228",
  "\\top": "\u22A4",
  "\\bot": "\u22A5",
  "\\cup": "\u222A",
  "\\cap": "\u2229",
  "\\bigcup": "\u22C3",
  "\\bigcap": "\u22C2",
  "\\setminus": "\u2216",
  "\\therefore": "\u2234",
  "\\because": "\u2235",
  "\\Box": "\u25A1",
  "\\models": "\u22A8",
  "\\vdash": "\u22A2",
  "\\rightarrow": "\u2192",
  "\\Rightarrow": "\u21D2",
  "\\leftarrow": "\u2190",
  "\\Leftarrow": "\u21D0",
  "\\uparrow": "\u2191",
  "\\Uparrow": "\u21D1",
  "\\downarrow": "\u2193",
  "\\Downarrow": "\u21D3",
  "\\nwarrow": "\u2196",
  "\\nearrow": "\u2197",
  "\\searrow": "\u2198",
  "\\swarrow": "\u2199",
  "\\mapsto": "\u21A6",
  "\\to": "\u2192",
  "\\leftrightarrow": "\u2194",
  "\\hookleftarrow": "\u21A9",
  "\\Leftrightarrow": "\u21D4",
  "\\rightarrowtail": "\u21A3",
  "\\leftarrowtail": "\u21A2",
  "\\twoheadrightarrow": "\u21A0",
  "\\twoheadleftarrow": "\u219E",
  "\\hookrightarrow": "\u21AA",
  "\\rightsquigarrow": "\u21DD",
  "\\rightleftharpoons": "\u21CC",
  "\\leftrightharpoons": "\u21CB",
  "\\rightharpoonup": "\u21C0",
  "\\rightharpoondown": "\u21C1",
  "\\times": "\u00D7",
  "\\div": "\u00F7",
  "\\infty": "\u221E",
  "\\nabla": "\u2207",
  "\\partial": "\u2202",
  "\\sum": "\u2211",
  "\\prod": "\u220F",
  "\\coprod": "\u2210",
  "\\int": "\u222B",
  "\\iint": "\u222C",
  "\\iiint": "\u222D",
  "\\iiiint": "\u2A0C",
  "\\oint": "\u222E",
  "\\surfintegral": "\u222F",
  "\\volintegral": "\u2230",
  "\\Re": "\u211C",
  "\\Im": "\u2111",
  "\\wp": "\u2118",
  "\\mp": "\u2213",
  "\\langle": "\u27E8",
  "\\rangle": "\u27E9",
  "\\lfloor": "\u230A",
  "\\rfloor": "\u230B",
  "\\lceil": "\u2308",
  "\\rceil": "\u2309",
  "\\|": "\u2016",
  "\\mathbb{a}": "\uD835\uDD52",
  "\\mathbb{A}": "\uD835\uDD38",
  "\\mathbb{b}": "\uD835\uDD53",
  "\\mathbb{B}": "\uD835\uDD39",
  "\\mathbb{c}": "\uD835\uDD54",
  "\\mathbb{C}": "\u2102",
  "\\mathbb{d}": "\uD835\uDD55",
  "\\mathbb{D}": "\uD835\uDD3B",
  "\\mathbb{e}": "\uD835\uDD56",
  "\\mathbb{E}": "\uD835\uDD3C",
  "\\mathbb{f}": "\uD835\uDD57",
  "\\mathbb{F}": "\uD835\uDD3D",
  "\\mathbb{g}": "\uD835\uDD58",
  "\\mathbb{G}": "\uD835\uDD3E",
  "\\mathbb{h}": "\uD835\uDD59",
  "\\mathbb{H}": "\u210D",
  "\\mathbb{i}": "\uD835\uDD5A",
  "\\mathbb{I}": "\uD835\uDD40",
  "\\mathbb{j}": "\uD835\uDD5B",
  "\\mathbb{J}": "\uD835\uDD41",
  "\\mathbb{k}": "\uD835\uDD5C",
  "\\mathbb{K}": "\uD835\uDD42",
  "\\mathbb{l}": "\uD835\uDD5D",
  "\\mathbb{L}": "\uD835\uDD43",
  "\\mathbb{m}": "\uD835\uDD5E",
  "\\mathbb{M}": "\uD835\uDD44",
  "\\mathbb{n}": "\uD835\uDD5F",
  "\\mathbb{N}": "\u2115",
  "\\mathbb{o}": "\uD835\uDD60",
  "\\mathbb{O}": "\uD835\uDD46",
  "\\mathbb{p}": "\uD835\uDD61",
  "\\mathbb{P}": "\u2119",
  "\\mathbb{q}": "\uD835\uDD62",
  "\\mathbb{Q}": "\u211A",
  "\\mathbb{r}": "\uD835\uDD63",
  "\\mathbb{R}": "\u211D",
  "\\mathbb{s}": "\uD835\uDD64",
  "\\mathbb{S}": "\uD835\uDD4A",
  "\\mathbb{t}": "\uD835\uDD65",
  "\\mathbb{T}": "\uD835\uDD4B",
  "\\mathbb{u}": "\uD835\uDD66",
  "\\mathbb{U}": "\uD835\uDD4C",
  "\\mathbb{v}": "\uD835\uDD67",
  "\\mathbb{V}": "\uD835\uDD4D",
  "\\mathbb{x}": "\uD835\uDD69",
  "\\mathbb{X}": "\uD835\uDD4F",
  "\\mathbb{y}": "\uD835\uDD6A",
  "\\mathbb{Y}": "\uD835\uDD50",
  "\\mathbb{z}": "\uD835\uDD6B",
  "\\mathbb{Z}": "\u2124",
  "\\mathbb{0}": "\uD835\uDFD8",
  "\\mathbb{1}": "\uD835\uDFD9",
  "\\mathbb{2}": "\uD835\uDFDA",
  "\\mathbb{3}": "\uD835\uDFDB",
  "\\mathbb{4}": "\uD835\uDFDC",
  "\\mathbb{5}": "\uD835\uDFDD",
  "\\mathbb{6}": "\uD835\uDFDE",
  "\\mathbb{7}": "\uD835\uDFDF",
  "\\mathbb{8}": "\uD835\uDFE0",
  "\\mathbb{9}": "\uD835\uDFE1",
  "\\mathfrak{a}": "\uD835\uDD1E",
  "\\mathfrak{A}": "\uD835\uDD04",
  "\\mathfrak{b}": "\uD835\uDD1F",
  "\\mathfrak{B}": "\uD835\uDD05",
  "\\mathfrak{c}": "\uD835\uDD20",
  "\\mathfrak{C}": "\u212D",
  "\\mathfrak{d}": "\uD835\uDD21",
  "\\mathfrak{D}": "\uD835\uDD07",
  "\\mathfrak{e}": "\uD835\uDD22",
  "\\mathfrak{E}": "\uD835\uDD08",
  "\\mathfrak{f}": "\uD835\uDD23",
  "\\mathfrak{F}": "\uD835\uDD09",
  "\\mathfrak{g}": "\uD835\uDD24",
  "\\mathfrak{G}": "\uD835\uDD0A",
  "\\mathfrak{h}": "\uD835\uDD25",
  "\\mathfrak{H}": "\u210C",
  "\\mathfrak{i}": "\uD835\uDD26",
  "\\mathfrak{I}": "\u2111",
  "\\mathfrak{j}": "\uD835\uDD27",
  "\\mathfrak{J}": "\uD835\uDD0D",
  "\\mathfrak{k}": "\uD835\uDD28",
  "\\mathfrak{K}": "\uD835\uDD0E",
  "\\mathfrak{l}": "\uD835\uDD29",
  "\\mathfrak{L}": "\uD835\uDD0F",
  "\\mathfrak{m}": "\uD835\uDD2A",
  "\\mathfrak{M}": "\uD835\uDD10",
  "\\mathfrak{n}": "\uD835\uDD2B",
  "\\mathfrak{N}": "\uD835\uDD11",
  "\\mathfrak{o}": "\uD835\uDD2C",
  "\\mathfrak{O}": "\uD835\uDD12",
  "\\mathfrak{p}": "\uD835\uDD2D",
  "\\mathfrak{P}": "\uD835\uDD13",
  "\\mathfrak{q}": "\uD835\uDD2E",
  "\\mathfrak{Q}": "\uD835\uDD14",
  "\\mathfrak{r}": "\uD835\uDD2F",
  "\\mathfrak{R}": "\u211C",
  "\\mathfrak{s}": "\uD835\uDD30",
  "\\mathfrak{S}": "\uD835\uDD16",
  "\\mathfrak{t}": "\uD835\uDD31",
  "\\mathfrak{T}": "\uD835\uDD17",
  "\\mathfrak{u}": "\uD835\uDD32",
  "\\mathfrak{U}": "\uD835\uDD18",
  "\\mathfrak{v}": "\uD835\uDD33",
  "\\mathfrak{V}": "\uD835\uDD19",
  "\\mathfrak{x}": "\uD835\uDD35",
  "\\mathfrak{X}": "\uD835\uDD1B",
  "\\mathfrak{y}": "\uD835\uDD36",
  "\\mathfrak{Y}": "\uD835\uDD1C",
  "\\mathfrak{z}": "\uD835\uDD37",
  "\\mathfrak{Z}": "\u2128",
  "\\mathcal{a}": "\uD835\uDCB6",
  "\\mathcal{A}": "\uD835\uDC9C",
  "\\mathcal{b}": "\uD835\uDCB7",
  "\\mathcal{B}": "\u212C",
  "\\mathcal{c}": "\uD835\uDCB8",
  "\\mathcal{C}": "\uD835\uDC9E",
  "\\mathcal{d}": "\uD835\uDCB9",
  "\\mathcal{D}": "\uD835\uDC9F",
  "\\mathcal{e}": "\u212F",
  "\\mathcal{E}": "\u2130",
  "\\mathcal{f}": "\uD835\uDCBB",
  "\\mathcal{F}": "\u2131",
  "\\mathcal{g}": "\u210A",
  "\\mathcal{G}": "\uD835\uDCA2",
  "\\mathcal{h}": "\uD835\uDCBD",
  "\\mathcal{H}": "\u210B",
  "\\mathcal{i}": "\uD835\uDCBE",
  "\\mathcal{I}": "\u2110",
  "\\mathcal{j}": "\uD835\uDCBF",
  "\\mathcal{J}": "\uD835\uDCA5",
  "\\mathcal{k}": "\uD835\uDCC0",
  "\\mathcal{K}": "\uD835\uDCA6",
  "\\mathcal{l}": "\uD835\uDCC1",
  "\\mathcal{L}": "\u2112",
  "\\mathcal{m}": "\uD835\uDCC2",
  "\\mathcal{M}": "\u2133",
  "\\mathcal{n}": "\uD835\uDCC3",
  "\\mathcal{N}": "\uD835\uDCA9",
  "\\mathcal{o}": "\u2134",
  "\\mathcal{O}": "\uD835\uDCAA",
  "\\mathcal{p}": "\uD835\uDCC5",
  "\\mathcal{P}": "\uD835\uDCAB",
  "\\mathcal{q}": "\uD835\uDCC6",
  "\\mathcal{Q}": "\uD835\uDCAC",
  "\\mathcal{r}": "\uD835\uDCC7",
  "\\mathcal{R}": "\u211B",
  "\\mathcal{s}": "\uD835\uDCC8",
  "\\mathcal{S}": "\uD835\uDCAE",
  "\\mathcal{t}": "\uD835\uDCC9",
  "\\mathcal{T}": "\uD835\uDCAF",
  "\\mathcal{u}": "\uD835\uDCCA",
  "\\mathcal{U}": "\uD835\uDCB0",
  "\\mathcal{v}": "\uD835\uDCCB",
  "\\mathcal{V}": "\uD835\uDCB1",
  "\\mathcal{w}": "\uD835\uDCCC",
  "\\mathcal{W}": "\uD835\uDCB2",
  "\\mathcal{x}": "\uD835\uDCCD",
  "\\mathcal{X}": "\uD835\uDCB3",
  "\\mathcal{y}": "\uD835\uDCCE",
  "\\mathcal{Y}": "\uD835\uDCB4",
  "\\mathcal{z}": "\uD835\uDCCF",
  "\\mathcal{Z}": "\uD835\uDCB5",
  "_0": "\u2080",
  "_1": "\u2081",
  "_2": "\u2082",
  "_3": "\u2083",
  "_4": "\u2084",
  "_5": "\u2085",
  "_6": "\u2086",
  "_7": "\u2087",
  "_8": "\u2088",
  "_9": "\u2089",
  "^0": "\u2070",
  "^1": "\u00B9",
  "^2": "\u00B2",
  "^3": "\u00B3",
  "^4": "\u2074",
  "^5": "\u2075",
  "^6": "\u2076",
  "^7": "\u2077",
  "^8": "\u2078",
  "^9": "\u2079",
  "_+": "\u208A",
  "_-": "\u208B",
  "_(": "\u208D",
  "_)": "\u208E",
  "^+": "\u207A",
  "^-": "\u207B",
  "^(": "\u207D",
  "^)": "\u207E",
  "_a": "\u2090",
  "_e": "\u2091",
  "_h": "\u2095",
  "_i": "\u1D62",
  "_j": "\u2C7C",
  "_k": "\u2096",
  "_l": "\u2097",
  "_m": "\u2098",
  "_n": "\u2099",
  "_o": "\u2092",
  "_p": "\u209A",
  "_r": "\u1D63",
  "_s": "\u209B",
  "_t": "\u209C",
  "_u": "\u1D64",
  "_v": "\u1D65",
  "_x": "\u2093",
  "^a": "\u1D43",
  "^b": "\u1D47",
  "^c": "\u1D9C",
  "^d": "\u1D48",
  "^e": "\u1D49",
  "^f": "\u1DA0",
  "^g": "\u1D4D",
  "^h": "\u02B0",
  "^i": "^i",
  "^j": "\u02B2",
  "^k": "\u1D4F",
  "^l": "\u02E1",
  "^m": "\u1D50",
  "^n": "\u207F",
  "^o": "\u1D52",
  "^p": "\u1D56",
  "^r": "\u02B3",
  "^s": "\u02E2",
  "^t": "\u1D57",
  "^u": "\u1D58",
  "^v": "\u1D5B",
  "^w": "\u02B7",
  "^x": "\u02E3",
  "^y": "\u02B8",
  "^z": "\u1DBB",
  "\\pm": "\u00B1",
  "\\dotplus": "\u2214",
  "\\bullet": "\u2219",
  "\\cdot": "\u22C5",
  "\\oplus": "\u2295",
  "\\ominus": "\u2296",
  "\\otimes": "\u2297",
  "\\oslash": "\u2298",
  "\\odot": "\u2299",
  "\\circ": "\u2218",
  "\\surd": "\u221A",
  "\\propto": "\u221D",
  "\\angle": "\u2220",
  "\\measuredangle": "\u2221",
  "\\sphericalangle": "\u2222",
  "\\mid": "\u2223",
  "\\nmid": "\u2224",
  "\\not\\mid": "\u2224",
  "\\parallel": "\u2225",
  "\\nparallel": "\u2226",
  "\\not\\parallel": "\u2226",
  "\\flat": "\u266D",
  "\\natural": "\u266E",
  "\\sharp": "\u266F",
  "\\lim": "lim",
  "\\sin": "sin",
  "\\cos": "cos",
  "\\tan": "tan",
  "\\cot": "cot",
  "\\sec": "sec",
  "\\csc": "csc",
  "\\ln": "ln",
  "\\log": "log",
  "\\exp": "exp",
  "\\max": "max",
  "\\min": "min",
  "\\sup": "sup",
  "\\inf": "inf",
  "\\det": "det",
  "\\dim": "dim",
  "\\mod": "mod",
  "\\gcd": "gcd",
  "\\ker": "ker",
  "\\Pr": "Pr"
};
  const suffixUnaryMacros = new Set(["\\vec", "\\hat", "\\bar", "\\dot", "\\ddot", "\\tilde", "\\acute", "\\grave", "\\check"]);
  const prefixUnaryMacros = new Set(["\\overbar", "\\overbrace", "\\underbrace", "\\underbar", "\\rect", "\\boxed", "\\matrix", "\\eqarray", "\\text", "\\mathrm", "\\mathit", "\\mathbf", "\\operatorname"]);

  function skipSpaces(state) {
    while (state.index < state.input.length && /\s/.test(state.input[state.index])) {
      state.index += 1;
    }
  }

  function collapseSpaces(text) {
    return text
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/([([{])\s+/g, "$1")
      .replace(/\s+([)\]}>/])/g, "$1")
      .trim();
  }

  function stripOuterBraces(text) {
    let result = text.trim();
    while (result.startsWith("{") && result.endsWith("}")) {
      result = result.slice(1, -1).trim();
    }
    return result;
  }

  function readBalanced(state, openChar, closeChar) {
    if (state.input[state.index] !== openChar) {
      return null;
    }

    state.index += 1;
    let depth = 1;
    const start = state.index;

    while (state.index < state.input.length) {
      const char = state.input[state.index];
      if (char === "\\") {
        state.index += 2;
        continue;
      }
      if (char === openChar) {
        depth += 1;
      } else if (char === closeChar) {
        depth -= 1;
        if (depth === 0) {
          const value = state.input.slice(start, state.index);
          state.index += 1;
          return value;
        }
      }
      state.index += 1;
    }

    return state.input.slice(start);
  }

  function readMacroName(state) {
    if (state.input[state.index] !== "\\") {
      return null;
    }

    let end = state.index + 1;
    while (end < state.input.length && /[A-Za-z]/.test(state.input[end])) {
      end += 1;
    }

    if (end === state.index + 1 && end < state.input.length) {
      end += 1;
    }

    const macro = state.input.slice(state.index, end);
    state.index = end;
    return macro;
  }

  function needsGrouping(text) {
    return /\s|[+\-*/=<>|&]/.test(text);
  }

  function wrapGroup(text) {
    const normalized = collapseSpaces(text);
    if (!normalized) {
      return "";
    }
    if (normalized.startsWith("(") && normalized.endsWith(")")) {
      return normalized;
    }
    return needsGrouping(normalized) ? `(${normalized})` : normalized;
  }

  function formatScript(op, value) {
    const normalized = collapseSpaces(value);
    if (!normalized) {
      return op;
    }
    if (normalized.length === 1) {
      return op + normalized;
    }
    if (normalized.startsWith("(") && normalized.endsWith(")")) {
      return op + normalized;
    }
    return op + `(${normalized})`;
  }

  function readConvertedArgument(state) {
    skipSpaces(state);
    const start = state.index;
    const char = state.input[state.index];

    if (char === "{") {
      const raw = readBalanced(state, "{", "}");
      return convertLatexToUnicodeMath(raw || "");
    }

    if (char === "[") {
      const raw = readBalanced(state, "[", "]");
      return convertLatexToUnicodeMath(raw || "");
    }

    if (char === "\\") {
      return parseMacro(state);
    }

    if (char === "^" || char === "_") {
      state.index += 1;
      return formatScript(char, readConvertedArgument(state));
    }

    state.index += 1;
    return state.input.slice(start, state.index);
  }

  function parseUnaryMacro(state, macro) {
    skipSpaces(state);

    if (macro === "\\not") {
      const savedIndex = state.index;
      if (state.input[state.index] === "\\") {
        const nextMacro = readMacroName(state);
        if (nextMacro && symbols[macro + nextMacro]) {
          return symbols[macro + nextMacro];
        }
        state.index = savedIndex;
      }
    }

    const rawGroup = state.input[state.index] === "{" ? readBalanced(state, "{", "}") : null;
    if (rawGroup != null) {
      const symbolKey = `${macro}{${stripOuterBraces(rawGroup)}}`;
      if (symbols[symbolKey]) {
        return symbols[symbolKey];
      }

      const convertedGroup = convertLatexToUnicodeMath(rawGroup);
      if (suffixUnaryMacros.has(macro)) {
        return wrapGroup(convertedGroup) + macro;
      }
      if (prefixUnaryMacros.has(macro)) {
        return `${macro}(${collapseSpaces(convertedGroup)})`;
      }
      return `${macro}(${collapseSpaces(convertedGroup)})`;
    }

    const fallbackArg = readConvertedArgument(state);
    if (!fallbackArg) {
      return macro;
    }
    if (suffixUnaryMacros.has(macro)) {
      return wrapGroup(fallbackArg) + macro;
    }
    return `${macro}(${collapseSpaces(fallbackArg)})`;
  }

  function parseMacro(state) {
    const macro = readMacroName(state);
    if (!macro) {
      return "";
    }

    if (macro === "\\left" || macro === "\\right") {
      skipSpaces(state);
      return "";
    }

    if (macro === "\\frac") {
      const numerator = readConvertedArgument(state);
      const denominator = readConvertedArgument(state);
      return `${wrapGroup(numerator)}/(${collapseSpaces(denominator)})`;
    }

    if (macro === "\\sqrt") {
      skipSpaces(state);
      let index = "";
      if (state.input[state.index] === "[") {
        index = convertLatexToUnicodeMath(readBalanced(state, "[", "]") || "");
      }
      const body = readConvertedArgument(state);
      return `\\sqrt(${index ? `${collapseSpaces(index)}&` : ""}${collapseSpaces(body)})`;
    }

    if (macro === "\\text" || macro === "\\mathrm" || macro === "\\mathit" || macro === "\\mathbf" || macro === "\\operatorname" || macro === "\\mathbb" || macro === "\\mathfrak" || macro === "\\mathcal" || macro === "\\not") {
      return parseUnaryMacro(state, macro);
    }

    if (symbols[macro]) {
      return symbols[macro];
    }

    return macro;
  }

  function convertExpression(state, stopChar) {
    let output = "";

    while (state.index < state.input.length) {
      const char = state.input[state.index];
      if (stopChar && char === stopChar) {
        break;
      }

      if (/\s/.test(char)) {
        output += " ";
        skipSpaces(state);
        continue;
      }

      if (char === "{") {
        const raw = readBalanced(state, "{", "}");
        output += wrapGroup(convertLatexToUnicodeMath(raw || ""));
        continue;
      }

      if (char === "[") {
        const raw = readBalanced(state, "[", "]");
        output += `[${convertLatexToUnicodeMath(raw || "")}]`;
        continue;
      }

      if (char === "^") {
        state.index += 1;
        output += formatScript("^", readConvertedArgument(state));
        continue;
      }

      if (char === "_") {
        state.index += 1;
        output += formatScript("_", readConvertedArgument(state));
        continue;
      }

      if (char === "\\") {
        output += parseMacro(state);
        continue;
      }

      output += char;
      state.index += 1;
    }

    return output;
  }

  function convertLatexToUnicodeMath(input) {
    const state = { input: String(input || ""), index: 0 };
    return collapseSpaces(convertExpression(state));
  }

  global.texToUnicodeMath = {
    convertLatexToUnicodeMath,
    symbols
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
