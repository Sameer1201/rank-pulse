import { useCallback, useEffect, useRef, useState } from "react";

type TcsCalculatorProps = {
  open: boolean;
  onClose: () => void;
};

type AngleMode = "DEG" | "RAD";

interface BtnProps {
  children: React.ReactNode;
  onClick: () => void;
  color?: "std" | "red" | "green" | "mem";
  colSpan?: number;
  rowSpan?: number;
  tid?: string;
}

const colors = {
  std: "bg-white border border-[#b0b0b0] text-[#111] hover:bg-[#f0f0f0] active:bg-[#e4e4e4]",
  red: "bg-[#d9534f] border border-[#a02020] text-white hover:bg-[#c9433f] active:bg-[#b83030]",
  green: "bg-[#5cb85c] border border-[#3a8a3a] text-white hover:bg-[#4caa4c] active:bg-[#3a9a3a]",
  mem: "bg-[#f5f5f5] border border-[#b0b0b0] text-[#333] hover:bg-[#e8e8e8] active:bg-[#ddd]",
};

function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) return NaN;
  if (n === 0 || n === 1) return 1;
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i += 1) r *= i;
  return r;
}

function toRad(v: number, mode: AngleMode): number {
  return mode === "DEG" ? (v * Math.PI) / 180 : v;
}

function fromRad(v: number, mode: AngleMode): number {
  return mode === "DEG" ? (v * 180) / Math.PI : v;
}

function fmt(v: number): string {
  if (Number.isNaN(v)) return "Error";
  if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-10)) {
    return v.toExponential(10).replace(/\.?0+(e)/, "$1");
  }
  return String(parseFloat(v.toPrecision(15)));
}

function Btn({ children, onClick, color = "std", colSpan, rowSpan, tid }: BtnProps) {
  const style: React.CSSProperties = {};
  if (colSpan) style.gridColumn = `span ${colSpan}`;
  if (rowSpan) style.gridRow = `span ${rowSpan}`;

  return (
    <button
      type="button"
      data-testid={tid}
      style={style}
      onClick={onClick}
      className={`
        ${colors[color]}
        flex items-center justify-center
        text-[13px] font-normal
        rounded-[6px]
        select-none cursor-pointer
        transition-colors duration-75
        shadow-[0_2px_0_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.6)]
        active:translate-y-[1px]
        active:shadow-[0_1px_0_rgba(0,0,0,0.25)]
        leading-none
      `}
    >
      {children}
    </button>
  );
}

export function TcsCalculator({ open, onClose }: TcsCalculatorProps) {
  const [exprDisplay, setExprDisplay] = useState("");
  const [valueDisplay, setValueDisplay] = useState("0");
  const [mode, setMode] = useState<AngleMode>("DEG");
  const [memory, setMemory] = useState(0);
  const [memSet, setMemSet] = useState(false);
  const [newEntry, setNewEntry] = useState(true);
  const [lastResult, setLastResult] = useState<number | null>(null);
  const [baseVal, setBaseVal] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ left: 0, top: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, panelLeft: 0, panelTop: 0 });

  const handleTitleBarMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panelLeft: panelPosition.left,
      panelTop: panelPosition.top,
    };
    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = ev.clientX - dragStartRef.current.mouseX;
      const dy = ev.clientY - dragStartRef.current.mouseY;
      const width = Math.min(760, window.innerWidth - 32);
      const newLeft = Math.max(0, Math.min(window.innerWidth - width, dragStartRef.current.panelLeft + dx));
      const newTop = Math.max(0, Math.min(window.innerHeight - 60, dragStartRef.current.panelTop + dy));
      setPanelPosition({ left: newLeft, top: newTop });
    };
    const onMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  }, [panelPosition.left, panelPosition.top]);

  const curNum = useCallback((): number => {
    if (newEntry && lastResult !== null) return lastResult;
    return parseFloat(valueDisplay) || 0;
  }, [lastResult, newEntry, valueDisplay]);

  const pushResult = useCallback((result: number, label: string) => {
    setExprDisplay(label);
    setValueDisplay(fmt(result));
    setLastResult(result);
    setNewEntry(true);
    setBaseVal(null);
    setPendingOp(null);
  }, []);

  const digit = useCallback(
    (d: string) => {
      if (newEntry) {
        setValueDisplay(d === "." ? "0." : d === "0" ? "0" : d);
        setNewEntry(false);
      } else {
        setValueDisplay((prev) => {
          if (d === "." && prev.includes(".")) return prev;
          if (prev === "0" && d !== ".") return d;
          return prev + d;
        });
      }
    },
    [newEntry],
  );

  const binaryOp = useCallback(
    (op: string, symbol: string) => {
      const v = curNum();
      setBaseVal(v);
      setPendingOp(op);
      setExprDisplay(fmt(v) + " " + symbol);
      setNewEntry(true);
    },
    [curNum],
  );

  const equals = useCallback(() => {
    const b = curNum();
    if (pendingOp && baseVal !== null) {
      const a = baseVal;
      let r: number;
      switch (pendingOp) {
        case "+":
          r = a + b;
          break;
        case "-":
          r = a - b;
          break;
        case "*":
          r = a * b;
          break;
        case "/":
          r = a / b;
          break;
        case "mod":
          r = a % b;
          break;
        case "pow":
          r = Math.pow(a, b);
          break;
        case "logyx":
          r = Math.log(b) / Math.log(a);
          break;
        default:
          r = b;
      }
      pushResult(r, `${fmt(a)} ${pendingOp === "pow" ? "^" : pendingOp} ${fmt(b)} =`);
    }
  }, [baseVal, curNum, pendingOp, pushResult]);

  const unary = useCallback(
    (fn: string) => {
      const v = curNum();
      let r: number;
      let label = "";

      switch (fn) {
        case "sin":
          r = Math.sin(toRad(v, mode));
          label = `sin(${fmt(v)})`;
          break;
        case "cos":
          r = Math.cos(toRad(v, mode));
          label = `cos(${fmt(v)})`;
          break;
        case "tan":
          r = Math.tan(toRad(v, mode));
          label = `tan(${fmt(v)})`;
          break;
        case "asin":
          r = fromRad(Math.asin(v), mode);
          label = `sin⁻¹(${fmt(v)})`;
          break;
        case "acos":
          r = fromRad(Math.acos(v), mode);
          label = `cos⁻¹(${fmt(v)})`;
          break;
        case "atan":
          r = fromRad(Math.atan(v), mode);
          label = `tan⁻¹(${fmt(v)})`;
          break;
        case "sinh":
          r = Math.sinh(v);
          label = `sinh(${fmt(v)})`;
          break;
        case "cosh":
          r = Math.cosh(v);
          label = `cosh(${fmt(v)})`;
          break;
        case "tanh":
          r = Math.tanh(v);
          label = `tanh(${fmt(v)})`;
          break;
        case "asinh":
          r = Math.asinh(v);
          label = `sinh⁻¹(${fmt(v)})`;
          break;
        case "acosh":
          r = Math.acosh(v);
          label = `cosh⁻¹(${fmt(v)})`;
          break;
        case "atanh":
          r = Math.atanh(v);
          label = `tanh⁻¹(${fmt(v)})`;
          break;
        case "log":
          r = Math.log10(v);
          label = `log(${fmt(v)})`;
          break;
        case "ln":
          r = Math.log(v);
          label = `ln(${fmt(v)})`;
          break;
        case "log2":
          r = Math.log2(v);
          label = `log₂(${fmt(v)})`;
          break;
        case "sqrt":
          r = Math.sqrt(v);
          label = `√(${fmt(v)})`;
          break;
        case "cbrt":
          r = Math.cbrt(v);
          label = `∛(${fmt(v)})`;
          break;
        case "sq":
          r = v * v;
          label = `(${fmt(v)})²`;
          break;
        case "cube":
          r = v * v * v;
          label = `(${fmt(v)})³`;
          break;
        case "inv":
          r = 1 / v;
          label = `1/(${fmt(v)})`;
          break;
        case "abs":
          r = Math.abs(v);
          label = `|${fmt(v)}|`;
          break;
        case "fact":
          r = factorial(v);
          label = `(${fmt(v)})!`;
          break;
        case "exp":
          r = Math.exp(v);
          label = `e^${fmt(v)}`;
          break;
        case "exp10":
          r = Math.pow(10, v);
          label = `10^${fmt(v)}`;
          break;
        case "neg":
          r = -v;
          label = `-(${fmt(v)})`;
          break;
        case "pct":
          r = v / 100;
          label = `${fmt(v)}%`;
          break;
        default:
          return;
      }

      pushResult(r, label);
    },
    [curNum, mode, pushResult],
  );

  const backspace = useCallback(() => {
    if (newEntry) return;
    setValueDisplay((prev) => {
      if (prev === "Error" || prev.length <= 1) return "0";
      return prev.slice(0, -1) || "0";
    });
  }, [newEntry]);

  const clear = useCallback(() => {
    setValueDisplay("0");
    setExprDisplay("");
    setNewEntry(true);
    setLastResult(null);
    setBaseVal(null);
    setPendingOp(null);
  }, []);

  const mem = useCallback(
    (action: string) => {
      const v = curNum();
      switch (action) {
        case "MC":
          setMemory(0);
          setMemSet(false);
          break;
        case "MR":
          setValueDisplay(fmt(memory));
          setNewEntry(true);
          break;
        case "MS":
          setMemory(v);
          setMemSet(true);
          break;
        case "M+":
          setMemory((m) => m + v);
          setMemSet(true);
          break;
        case "M-":
          setMemory((m) => m - v);
          setMemSet(true);
          break;
        default:
      }
    },
    [curNum, memory],
  );

  const constant = useCallback((c: string) => {
    const v = c === "π" ? Math.PI : Math.E;
    setValueDisplay(fmt(v));
    setExprDisplay(c);
    setLastResult(v);
    setNewEntry(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const positionPanel = () => {
      const width = Math.min(760, window.innerWidth - 32);
      const left = Math.min(
        Math.max(16, Math.round(window.innerWidth * 0.48)),
        window.innerWidth - width - 16,
      );
      const top = Math.min(
        Math.max(110, Math.round(window.innerHeight * 0.2)),
        window.innerHeight - (minimized ? 70 : 560),
      );
      setPanelPosition({ left, top });
    };
    positionPanel();
    window.addEventListener("resize", positionPanel);
    return () => window.removeEventListener("resize", positionPanel);
  }, [minimized, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        digit(e.key);
        return;
      }
      if (e.key === ".") {
        digit(".");
        return;
      }
      if (e.key === "+") {
        binaryOp("+", "+");
        return;
      }
      if (e.key === "-") {
        binaryOp("-", "−");
        return;
      }
      if (e.key === "*") {
        binaryOp("*", "×");
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        binaryOp("/", "÷");
        return;
      }
      if (e.key === "Enter" || e.key === "=") {
        equals();
        return;
      }
      if (e.key === "Backspace") {
        backspace();
        return;
      }
      if (e.key === "Escape" || e.key === "Delete") {
        clear();
        return;
      }
      if (e.key === "%") {
        unary("pct");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [backspace, binaryOp, clear, digit, equals, open, unary]);

  if (!open) return null;

  const valLen = valueDisplay.length;
  const fontSize = valLen > 18 ? 14 : valLen > 14 ? 17 : valLen > 10 ? 20 : 24;

  return (
    <div
      className="fixed z-[70]"
      style={{
        left: panelPosition.left,
        top: panelPosition.top,
        width: Math.min(760, window.innerWidth - 32),
      }}
    >
      <div
        style={{
          background: "#d4d0c8",
          border: "2px solid #ffffff",
          outline: "1px solid #808080",
          boxShadow: "2px 2px 8px rgba(0,0,0,0.5)",
          fontFamily: "Arial, 'Helvetica Neue', sans-serif",
        }}
      >
        <div
          onMouseDown={handleTitleBarMouseDown}
          style={{
            background: "linear-gradient(180deg, #5ea6ea 0%, #3c7ec4 100%)",
            padding: "6px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: 44,
            cursor: "move",
            userSelect: "none",
          }}
        >
          <span style={{ color: "#fff", fontSize: 20, fontWeight: "bold", letterSpacing: 0.3 }}>
            Scientific Calculator
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              style={{
                background: "linear-gradient(180deg, #7ecef0 0%, #3cb8e8 100%)",
                border: "1px solid #2090c0",
                borderRadius: 5,
                color: "#fff",
                fontWeight: "bold",
                fontSize: 15,
                padding: "4px 22px",
                cursor: "pointer",
              }}
              onClick={() => window.alert("Use the keypad or keyboard to enter values and press = to evaluate.")}
              data-testid="button-help"
            >
              Help
            </button>
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                color: "#fff",
                fontSize: 18,
                fontWeight: "bold",
                cursor: "pointer",
                padding: "0 6px",
                lineHeight: 1,
              }}
              onClick={() => setMinimized((value) => !value)}
              data-testid="button-minimize"
            >
              _
            </button>
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                color: "#fff",
                fontSize: 18,
                fontWeight: "bold",
                cursor: "pointer",
                padding: "0 6px",
                lineHeight: 1,
              }}
              onClick={onClose}
              data-testid="button-close"
            >
              ✕
            </button>
          </div>
        </div>

        {!minimized && (
          <div style={{ padding: "10px 14px 14px 14px" }}>
            <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                readOnly
                value={exprDisplay}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  height: 38,
                  padding: "0 8px",
                  background: "#fff",
                  border: "1px solid #808080",
                  borderStyle: "inset" as never,
                  fontSize: 13,
                  color: "#333",
                  textAlign: "right",
                  outline: "none",
                  fontFamily: "Arial, sans-serif",
                  borderRadius: 2,
                }}
                data-testid="display-expr"
              />
              <input
                readOnly
                value={valueDisplay}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  height: 44,
                  padding: "0 10px",
                  background: "#fff",
                  border: "1px solid #808080",
                  borderStyle: "inset" as never,
                  fontSize,
                  color: "#000",
                  textAlign: "right",
                  outline: "none",
                  fontFamily: "Arial, sans-serif",
                  fontWeight: "normal",
                  borderRadius: 2,
                }}
                data-testid="display-value"
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 6 }}>
              <Btn onClick={() => binaryOp("mod", "mod")} tid="button-mod">
                mod
              </Btn>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 10px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 14, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="angle"
                    value="DEG"
                    checked={mode === "DEG"}
                    onChange={() => setMode("DEG")}
                    style={{ width: 16, height: 16, accentColor: "#1a6ac8" }}
                    data-testid="radio-deg"
                  />
                  Deg
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 14, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="angle"
                    value="RAD"
                    checked={mode === "RAD"}
                    onChange={() => setMode("RAD")}
                    style={{ width: 16, height: 16, accentColor: "#1a6ac8" }}
                    data-testid="radio-rad"
                  />
                  Rad
                </label>
              </div>
              <div style={{ flex: 1 }} />
              {(["MC", "MR", "MS", "M+", "M-"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => mem(m)}
                  data-testid={`button-mem-${m}`}
                  style={{
                    background: "#f0f0f0",
                    border: "1px solid #b0b0b0",
                    borderRadius: 6,
                    padding: "5px 10px",
                    fontSize: 13,
                    fontWeight: m === "MR" && memSet ? "bold" : "normal",
                    cursor: "pointer",
                    color: "#111",
                    minWidth: 44,
                    boxShadow: "0 2px 0 rgba(0,0,0,0.2),inset 0 1px 0 rgba(255,255,255,0.7)",
                    fontFamily: "Arial, sans-serif",
                  }}
                >
                  {m}
                </button>
              ))}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(11, 1fr)",
                gridAutoRows: "50px",
                gap: 5,
              }}
            >
              <Btn onClick={() => unary("sinh")} tid="btn-sinh">sinh</Btn>
              <Btn onClick={() => unary("cosh")} tid="btn-cosh">cosh</Btn>
              <Btn onClick={() => unary("tanh")} tid="btn-tanh">tanh</Btn>
              <Btn onClick={() => binaryOp("pow", "Exp")} tid="btn-exp">Exp</Btn>
              <Btn onClick={() => setExprDisplay((p) => p + "(")} tid="btn-lp">(</Btn>
              <Btn onClick={() => setExprDisplay((p) => p + ")")} tid="btn-rp">)</Btn>
              <button
                type="button"
                data-testid="btn-back"
                onClick={backspace}
                style={{
                  gridColumn: "span 2",
                  background: "#d9534f",
                  border: "1px solid #a02020",
                  borderRadius: 6,
                  color: "#fff",
                  fontSize: 18,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 2px 0 rgba(0,0,0,0.25),inset 0 1px 0 rgba(255,255,255,0.2)",
                  fontFamily: "Arial, sans-serif",
                }}
              >
                ←
              </button>
              <Btn onClick={clear} color="red" tid="btn-c">C</Btn>
              <Btn onClick={() => unary("neg")} color="red" tid="btn-pm">+/-</Btn>
              <Btn onClick={() => unary("sqrt")} tid="btn-sqrt">√</Btn>

              <Btn onClick={() => unary("asinh")} tid="btn-asinh"><span>sinh<sup style={{ fontSize: 9 }}>-1</sup></span></Btn>
              <Btn onClick={() => unary("acosh")} tid="btn-acosh"><span>cosh<sup style={{ fontSize: 9 }}>-1</sup></span></Btn>
              <Btn onClick={() => unary("atanh")} tid="btn-atanh"><span>tanh<sup style={{ fontSize: 9 }}>-1</sup></span></Btn>
              <Btn onClick={() => unary("log2")} tid="btn-log2x"><span>log<sub style={{ fontSize: 9 }}>2</sub>x</span></Btn>
              <Btn onClick={() => unary("ln")} tid="btn-ln">ln</Btn>
              <Btn onClick={() => unary("log")} tid="btn-log">log</Btn>
              <Btn onClick={() => digit("7")} tid="btn-7">7</Btn>
              <Btn onClick={() => digit("8")} tid="btn-8">8</Btn>
              <Btn onClick={() => digit("9")} tid="btn-9">9</Btn>
              <Btn onClick={() => binaryOp("/", "÷")} tid="btn-div">/</Btn>
              <Btn onClick={() => unary("pct")} tid="btn-pct">%</Btn>

              <Btn onClick={() => constant("π")} tid="btn-pi">π</Btn>
              <Btn onClick={() => constant("e")} tid="btn-e">e</Btn>
              <Btn onClick={() => unary("fact")} tid="btn-fact">n!</Btn>
              <Btn onClick={() => binaryOp("logyx", "logyx")} tid="btn-logyx"><span>log<sub style={{ fontSize: 9 }}>y</sub>x</span></Btn>
              <Btn onClick={() => unary("exp")} tid="btn-ex"><span>e<sup style={{ fontSize: 9 }}>x</sup></span></Btn>
              <Btn onClick={() => unary("exp10")} tid="btn-10x"><span>10<sup style={{ fontSize: 9 }}>x</sup></span></Btn>
              <Btn onClick={() => digit("4")} tid="btn-4">4</Btn>
              <Btn onClick={() => digit("5")} tid="btn-5">5</Btn>
              <Btn onClick={() => digit("6")} tid="btn-6">6</Btn>
              <Btn onClick={() => binaryOp("*", "×")} tid="btn-mul">*</Btn>
              <Btn onClick={() => unary("inv")} tid="btn-inv">1/x</Btn>

              <Btn onClick={() => unary("sin")} tid="btn-sin">sin</Btn>
              <Btn onClick={() => unary("cos")} tid="btn-cos">cos</Btn>
              <Btn onClick={() => unary("tan")} tid="btn-tan">tan</Btn>
              <Btn onClick={() => binaryOp("pow", "^")} tid="btn-xy"><span>x<sup style={{ fontSize: 9 }}>y</sup></span></Btn>
              <Btn onClick={() => unary("cube")} tid="btn-cube"><span>x<sup style={{ fontSize: 9 }}>3</sup></span></Btn>
              <Btn onClick={() => unary("sq")} tid="btn-sq"><span>x<sup style={{ fontSize: 9 }}>2</sup></span></Btn>
              <Btn onClick={() => digit("1")} tid="btn-1">1</Btn>
              <Btn onClick={() => digit("2")} tid="btn-2">2</Btn>
              <Btn onClick={() => digit("3")} tid="btn-3">3</Btn>
              <Btn onClick={() => binaryOp("-", "−")} tid="btn-sub">-</Btn>
              <button
                type="button"
                data-testid="btn-eq"
                onClick={equals}
                style={{
                  gridRow: "span 2",
                  background: "linear-gradient(180deg, #6ecf6e 0%, #4cb04c 100%)",
                  border: "1px solid #3a8a3a",
                  borderRadius: 6,
                  color: "#fff",
                  fontSize: 28,
                  fontWeight: "bold",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 2px 0 rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.3)",
                  fontFamily: "Arial, sans-serif",
                }}
              >
                =
              </button>

              <Btn onClick={() => unary("asin")} tid="btn-asin"><span>sin<sup style={{ fontSize: 9 }}>-1</sup></span></Btn>
              <Btn onClick={() => unary("acos")} tid="btn-acos"><span>cos<sup style={{ fontSize: 9 }}>-1</sup></span></Btn>
              <Btn onClick={() => unary("atan")} tid="btn-atan"><span>tan<sup style={{ fontSize: 9 }}>-1</sup></span></Btn>
              <Btn onClick={() => binaryOp("logyx", "y√x")} tid="btn-yrootx"><span><sup style={{ fontSize: 9 }}>y</sup>√x</span></Btn>
              <Btn onClick={() => unary("cbrt")} tid="btn-cbrt"><span><sup style={{ fontSize: 9 }}>3</sup>√</span></Btn>
              <Btn onClick={() => unary("abs")} tid="btn-abs">|x|</Btn>
              <button
                type="button"
                data-testid="btn-0"
                onClick={() => digit("0")}
                style={{
                  gridColumn: "span 2",
                  background: "#fff",
                  border: "1px solid #b0b0b0",
                  borderRadius: 6,
                  color: "#111",
                  fontSize: 13,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 2px 0 rgba(0,0,0,0.2),inset 0 1px 0 rgba(255,255,255,0.7)",
                  fontFamily: "Arial, sans-serif",
                }}
              >
                0
              </button>
              <Btn onClick={() => digit(".")} tid="btn-dot">.</Btn>
              <Btn onClick={() => binaryOp("+", "+")} tid="btn-add">+</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
