import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import katex from "katex";
import { Bold, Italic, Underline, Superscript, Subscript, Undo2, Redo2, ImagePlus, Sigma, Trash2, Replace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RichQuestionContent } from "@/components/ui/rich-question-content";
import { cn } from "@/lib/utils";
import { optimizeImageToDataUrl } from "@/lib/imageUpload";
import { sanitizeRichHtml } from "@/lib/richContent";
import { protectEditorMath, richEditorHtml, serializeRichEditor } from "@/lib/rich-question-editor";

interface RichQuestionEditorProps {
  value: string;
  onChange: (html: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  compact?: boolean;
}

/** The editable document owns its DOM; parent state never rewrites each keystroke. */
export function RichQuestionEditor({ value, onChange, ariaLabel, placeholder, className, compact = false }: RichQuestionEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const rangeRef = useRef<Range | null>(null);
  const emittedRef = useRef<string | null>(null);
  const historyRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  const imageTargetRef = useRef<HTMLImageElement | null>(null);
  const formulaTargetRef = useRef<HTMLElement | null>(null);
  const imageModeRef = useRef<"add" | "replace">("add");
  const [, setHistoryVersion] = useState(0);
  const [selectedImage, setSelectedImage] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formula, setFormula] = useState("");
  const [displayMath, setDisplayMath] = useState(false);

  const clearImageSelection = () => {
    imageTargetRef.current?.removeAttribute("data-editor-selected");
    imageTargetRef.current = null;
    setSelectedImage(false);
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === emittedRef.current) return;
    const html = richEditorHtml(value);
    editor.innerHTML = html;
    protectEditorMath(editor);
    historyRef.current = [html];
    indexRef.current = 0;
    rangeRef.current = null;
    emittedRef.current = value;
    clearImageSelection();
    formulaTargetRef.current = null;
    setFormulaOpen(false);
    setHistoryVersion((version) => version + 1);
  }, [value]);

  const rememberRange = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editorRef.current?.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      rangeRef.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const restoreRange = () => {
    const editor = editorRef.current;
    if (!editor) return null;
    editor.focus();
    const range = rangeRef.current && editor.contains(rangeRef.current.commonAncestorContainer)
      ? rangeRef.current.cloneRange() : document.createRange();
    if (!rangeRef.current || !editor.contains(rangeRef.current.commonAncestorContainer)) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return range;
  };

  const emit = () => {
    const editor = editorRef.current;
    if (!editor) return;
    protectEditorMath(editor);
    const html = serializeRichEditor(editor);
    if (historyRef.current[indexRef.current] !== html) {
      historyRef.current = [...historyRef.current.slice(0, indexRef.current + 1), html].slice(-50);
      // Embedded base64 diagrams can be large. Bound history memory as well as
      // entry count, while retaining at least one undo for oversized documents.
      let characters = historyRef.current.reduce((sum, entry) => sum + entry.length, 0);
      while (historyRef.current.length > 2 && characters > 4 * 1024 * 1024) {
        characters -= historyRef.current.shift()!.length;
      }
      indexRef.current = historyRef.current.length - 1;
      setHistoryVersion((version) => version + 1);
    }
    emittedRef.current = html;
    onChange(html);
    rememberRange();
  };

  const insertHtml = (html: string) => {
    const range = restoreRange();
    if (!range) return;
    // All ingress is sanitized, including pasted markup and optimized images.
    const fragment = range.createContextualFragment(sanitizeRichHtml(html));
    const last = fragment.lastChild;
    range.deleteContents();
    range.insertNode(fragment);
    if (last) { range.setStartAfter(last); range.collapse(true); }
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    rangeRef.current = range.cloneRange();
    emit();
  };

  const format = (command: string) => {
    restoreRange();
    document.execCommand(command, false);
    emit();
  };

  const history = (direction: -1 | 1) => {
    const next = indexRef.current + direction;
    const editor = editorRef.current;
    if (!editor || next < 0 || next >= historyRef.current.length) return;
    indexRef.current = next;
    const html = historyRef.current[next];
    editor.innerHTML = html;
    protectEditorMath(editor);
    clearImageSelection();
    rangeRef.current = null;
    emittedRef.current = html;
    onChange(html);
    setHistoryVersion((version) => version + 1);
    restoreRange();
  };

  const addImages = async (files: File[]) => {
    const editor = editorRef.current;
    if (!editor || !files.length) return;
    const target = imageModeRef.current === "replace" ? imageTargetRef.current : null;
    // Preserve insertion position across asynchronous decoding/file picker focus.
    const insertionRange = rangeRef.current?.cloneRange() ?? null;
    setImageBusy(true);
    setError("");
    try {
      const sources = await Promise.all(files.filter((file) => file.type.startsWith("image/")).map((file) =>
        optimizeImageToDataUrl(file, { maxWidth: 1800, maxHeight: 1800, quality: 0.82 })));
      if (!editor.isConnected || editor !== editorRef.current) return;
      if (target && editor.contains(target) && sources[0]) {
        target.src = sources[0];
        emit();
      } else {
        rangeRef.current = insertionRange;
        insertHtml(sources.map((src) => `<p><img src="${src}" alt="Uploaded image"></p>`).join(""));
      }
    } catch { setError("Image could not be loaded. Please try another image."); }
    finally { setImageBusy(false); }
  };

  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    rememberRange();
    imageModeRef.current = "add";
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (images.length) { void addImages(images); return; }
    const html = event.clipboardData.getData("text/html");
    // A plain-text paste is text, even if it happens to contain HTML-looking tags.
    if (html) insertHtml(richEditorHtml(html));
    else {
      const holder = document.createElement("div");
      holder.textContent = event.clipboardData.getData("text/plain");
      insertHtml(holder.innerHTML.replace(/\r?\n/g, "<br>"));
    }
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    rememberRange();
    imageModeRef.current = "add";
    const images = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
    if (images.length) void addImages(images);
    else {
      const holder = document.createElement("div");
      holder.textContent = event.dataTransfer.getData("text/plain");
      insertHtml(holder.innerHTML.replace(/\r?\n/g, "<br>"));
    }
  };

  const openFormula = (target: HTMLElement | null = null) => {
    rememberRange();
    formulaTargetRef.current = target;
    setFormula(target?.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? "");
    setDisplayMath(Boolean(target?.classList.contains("katex-display")));
    setError("");
    setFormulaOpen(true);
  };

  let formulaHtml = "";
  let formulaError = "";
  if (formula.trim()) {
    try { formulaHtml = katex.renderToString(formula, { throwOnError: true, trust: false, output: "htmlAndMathml", displayMode: displayMath }); }
    catch { formulaError = "Check the formula syntax before applying."; }
  }

  const tools = [
    { label: "Bold", icon: Bold, command: "bold" },
    { label: "Italic", icon: Italic, command: "italic" },
    { label: "Underline", icon: Underline, command: "underline" },
    { label: "Superscript", icon: Superscript, command: "superscript" },
    { label: "Subscript", icon: Subscript, command: "subscript" },
  ];

  return <div className={cn("min-w-0 overflow-hidden rounded-xl border border-border bg-background text-foreground focus-within:ring-1 focus-within:ring-orange-400", className)}>
    <div role="toolbar" aria-label={`${ariaLabel} formatting`} className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-2 py-1">
      {tools.map(({ label, icon: Icon, command }) => <Button key={command} type="button" variant="ghost" size="icon" className="h-7 w-7" title={label} aria-label={label} onMouseDown={(event) => event.preventDefault()} onClick={() => format(command)}><Icon className="h-3.5 w-3.5" /></Button>)}
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Undo" title="Undo" disabled={indexRef.current === 0} onMouseDown={(event) => event.preventDefault()} onClick={() => history(-1)}><Undo2 className="h-3.5 w-3.5" /></Button>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Redo" title="Redo" disabled={indexRef.current >= historyRef.current.length - 1} onMouseDown={(event) => event.preventDefault()} onClick={() => history(1)}><Redo2 className="h-3.5 w-3.5" /></Button>
      <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onMouseDown={(event) => event.preventDefault()} onClick={() => openFormula()}><Sigma className="h-3.5 w-3.5" />Formula</Button>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Insert image" aria-label="Insert image" disabled={imageBusy} onMouseDown={(event) => event.preventDefault()} onClick={() => { rememberRange(); imageModeRef.current = "add"; pickerRef.current?.click(); }}><ImagePlus className="h-3.5 w-3.5" /></Button>
      {selectedImage ? <>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Replace selected image" aria-label="Replace selected image" disabled={imageBusy} onMouseDown={(event) => event.preventDefault()} onClick={() => { imageModeRef.current = "replace"; pickerRef.current?.click(); }}><Replace className="h-3.5 w-3.5" /></Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Remove selected image" aria-label="Remove selected image" onMouseDown={(event) => event.preventDefault()} onClick={() => { imageTargetRef.current?.remove(); clearImageSelection(); emit(); }}><Trash2 className="h-3.5 w-3.5" /></Button>
      </> : null}
      <input ref={pickerRef} type="file" accept="image/*" multiple={imageModeRef.current !== "replace"} className="hidden" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void addImages(files); }} />
    </div>
    <div ref={editorRef} role="textbox" aria-label={ariaLabel} aria-multiline="true" contentEditable suppressContentEditableWarning data-placeholder={placeholder}
      onInput={emit} onKeyUp={rememberRange} onMouseUp={rememberRange} onBlur={rememberRange} onPaste={paste} onDragOver={(event) => event.preventDefault()} onDrop={drop}
      onClick={(event) => {
        clearImageSelection();
        if (event.target instanceof HTMLImageElement) { imageTargetRef.current = event.target; event.target.setAttribute("data-editor-selected", "true"); setSelectedImage(true); }
      }}
      onDoubleClick={(event) => { const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".katex-display, .katex") : null; if (target) openFormula(target.closest<HTMLElement>(".katex-display") ?? target); }}
      onKeyDown={(event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        const key = event.key.toLowerCase();
        if (key === "z" || key === "y") { event.preventDefault(); history(key === "y" || event.shiftKey ? 1 : -1); }
      }}
      className={cn("[&_.boolean-overline]:inline-block [&_.boolean-overline]:border-t [&_.boolean-overline]:border-current [&_.boolean-overline]:leading-tight", "rich-question-content rich-question-editor max-h-[65vh] overflow-y-auto p-3 text-base leading-relaxed outline-none empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] [&_p]:my-2 [&_img]:my-2 [&_img]:max-h-96 [&_img]:max-w-full [&_img]:object-contain [&_table]:w-full [&_table]:table-fixed [&_td]:border [&_th]:border [&_td]:p-1 [&_th]:p-1 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_[data-editor-selected]]:outline [&_[data-editor-selected]]:outline-2 [&_[data-editor-selected]]:outline-orange-400 [&_.katex]:cursor-pointer [&_.math-frac]:inline-flex [&_.math-frac]:flex-col [&_.math-frac]:align-middle [&_.math-frac-num]:border-b [&_.math-frac-num]:border-current", compact ? "min-h-11 text-sm" : "min-h-[170px]")} />
    {imageBusy ? <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">Loading image…</p> : null}
    {error ? <p role="alert" className="px-3 pb-2 text-xs text-destructive">{error}</p> : null}
    <Dialog open={formulaOpen} onOpenChange={setFormulaOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{formulaTargetRef.current ? "Edit formula" : "Insert formula"}</DialogTitle><DialogDescription>Double-click a rendered formula to edit it. Use LaTeX for fractions, bars and symbols.</DialogDescription></DialogHeader>
        <Textarea aria-label="Formula notation" value={formula} onChange={(event) => setFormula(event.target.value)} placeholder={"\\overline{A+B} \\oplus C"} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={displayMath} onChange={(event) => setDisplayMath(event.target.checked)} />Separate line</label>
        <div className="min-h-16 rounded-lg border border-border p-3"><RichQuestionContent content={formulaHtml} /></div>
        {formulaError ? <p role="alert" className="text-sm text-destructive">{formulaError}</p> : null}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setFormulaOpen(false)}>Cancel</Button><Button type="button" disabled={!formulaHtml || Boolean(formulaError)} onClick={() => {
          const target = formulaTargetRef.current;
          if (target && editorRef.current?.contains(target)) { const range = document.createRange(); range.selectNode(target); rangeRef.current = range; }
          insertHtml(formulaHtml);
          setFormulaOpen(false);
        }}>Apply formula</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
