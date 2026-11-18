import { useEffect, useRef, useState } from "react";
import { App as AntApp } from "antd";
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BoldOutlined,
  ItalicOutlined,
  OrderedListOutlined,
  PictureOutlined,
  StrikethroughOutlined,
  UnderlineOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useIntl } from "@umijs/max";
import { uploadPmImage } from "../api";
import "./RichTextEditor.css";

interface Props {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
}

/** 单图最大上传体积（后端 pm 分类上限 5MB，前端超 4MB 先压缩） */
const COMPRESS_THRESHOLD = 4 * 1024 * 1024;

/** 大图压缩：等比缩到最长边 1600px，导出 JPEG 0.85，控制在 5MB 内 */
async function maybeCompress(file: File): Promise<File> {
  if (file.size <= COMPRESS_THRESHOLD || !file.type.startsWith("image/")) {
    return file;
  }
  const bitmap = await createImageBitmap(file);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, "image/jpeg", 0.85)
  );
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
    type: "image/jpeg",
  });
}

/** 选中态用的 class，仅作视觉高亮，emit 前会剥离，不落库 */
const SEL_CLASS = "pm-rte-img-sel";

type Align = "left" | "center" | "right";

/**
 * 轻量富文本编辑器（contentEditable）。
 * - 支持直接 Ctrl/Cmd+V 粘贴图片、拖拽图片 → 上传到 /app/upload/image/pm，插入 <img>。
 * - 工具栏：加粗/斜体/下划线/删除线、有序/无序列表、左中右对齐、插入图片。
 * - 点击图片可选中；选中后对齐按钮作用于图片（block+margin），并可切换小/中/满宽。
 * - 输出 HTML 字符串；保存到 pm_task.description / pm_bug.description。
 * 非受控：仅在挂载/外部 value 变化且未聚焦时回填，避免光标跳动。
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const selImgRef = useRef<HTMLImageElement | null>(null);
  const [imgSelected, setImgSelected] = useState(false);
  const { message } = AntApp.useApp();
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return; // 编辑中不打断
    if (el.innerHTML !== (value ?? "")) {
      el.innerHTML = value ?? "";
    }
  }, [value]);

  // 输出时剥离仅用于高亮的选中 class，避免脏样式落库
  const emit = () => {
    const el = ref.current;
    if (!el) return;
    let html = el.innerHTML;
    if (html.includes(SEL_CLASS)) {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(`.${SEL_CLASS}`).forEach((n) => {
        n.classList.remove(SEL_CLASS);
        if (!n.getAttribute("class")) n.removeAttribute("class");
      });
      html = clone.innerHTML;
    }
    onChange?.(html);
  };

  const selectImg = (img: HTMLImageElement | null) => {
    if (selImgRef.current && selImgRef.current !== img) {
      selImgRef.current.classList.remove(SEL_CLASS);
    }
    selImgRef.current = img;
    if (img) {
      img.classList.add(SEL_CLASS);
      // 把 DOM 选区落在图片上，键盘删除等行为一致
      const range = document.createRange();
      range.selectNode(img);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    setImgSelected(!!img);
  };

  const insertImage = (url: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // execCommand 已废弃但在 contentEditable 富文本场景仍是各浏览器最稳的插入方式
    document.execCommand("insertHTML", false, `<img src="${url}" alt="" />`);
    emit();
  };

  const uploadAndInsert = async (file: File) => {
    const hide = message.loading(t("pm.rte.uploading"), 0);
    try {
      const compressed = await maybeCompress(file);
      const url = await uploadPmImage(compressed);
      insertImage(url);
    } catch {
      message.error(t("pm.rte.uploadFailed"));
    } finally {
      hide();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const images = items.filter((it) => it.type.startsWith("image/"));
    if (images.length === 0) return; // 纯文本走默认粘贴
    e.preventDefault();
    for (const it of images) {
      const file = it.getAsFile();
      if (file) uploadAndInsert(file);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (files.length === 0) return;
    e.preventDefault();
    for (const f of files) uploadAndInsert(f);
  };

  const exec = (cmd: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false);
    emit();
  };

  // 对齐：选中图片时作用于图片本身，否则作用于文本块
  const applyAlign = (align: Align) => {
    const img = selImgRef.current;
    if (img) {
      img.style.display = "block";
      img.style.marginLeft = align === "left" ? "0" : "auto";
      img.style.marginRight = align === "right" ? "0" : "auto";
      emit();
      return;
    }
    exec(
      align === "left"
        ? "justifyLeft"
        : align === "center"
        ? "justifyCenter"
        : "justifyRight"
    );
  };

  const setImgWidth = (width: string) => {
    const img = selImgRef.current;
    if (!img) return;
    img.style.width = width;
    img.style.height = "auto";
    emit();
  };

  const onBodyClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG") {
      selectImg(target as HTMLImageElement);
    } else if (selImgRef.current) {
      selectImg(null);
    }
  };

  const pickImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) uploadAndInsert(f);
    };
    input.click();
  };

  // 工具栏按钮统一 mousedown 阻止默认，避免抢焦点导致选区/图片选中丢失
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  const btn = (title: string, onClick: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      title={title}
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  return (
    <div className="pm-rte">
      <div className="pm-rte-toolbar">
        {btn(t("pm.rte.bold"), () => exec("bold"), <BoldOutlined />)}
        {btn(t("pm.rte.italic"), () => exec("italic"), <ItalicOutlined />)}
        {btn(
          t("pm.rte.underline"),
          () => exec("underline"),
          <UnderlineOutlined />
        )}
        {btn(
          t("pm.rte.strike"),
          () => exec("strikeThrough"),
          <StrikethroughOutlined />
        )}
        <span className="pm-rte-sep" />
        {btn(
          t("pm.rte.bulletList"),
          () => exec("insertUnorderedList"),
          <UnorderedListOutlined />
        )}
        {btn(
          t("pm.rte.orderedList"),
          () => exec("insertOrderedList"),
          <OrderedListOutlined />
        )}
        <span className="pm-rte-sep" />
        {btn(
          t("pm.rte.alignLeft"),
          () => applyAlign("left"),
          <AlignLeftOutlined />
        )}
        {btn(
          t("pm.rte.alignCenter"),
          () => applyAlign("center"),
          <AlignCenterOutlined />
        )}
        {btn(
          t("pm.rte.alignRight"),
          () => applyAlign("right"),
          <AlignRightOutlined />
        )}
        <span className="pm-rte-sep" />
        {btn(t("pm.rte.insertImage"), pickImage, <PictureOutlined />)}
        {imgSelected && (
          <>
            <span className="pm-rte-sep" />
            {btn(
              t("pm.rte.imgSmall"),
              () => setImgWidth("30%"),
              <span className="pm-rte-txt">S</span>
            )}
            {btn(
              t("pm.rte.imgMedium"),
              () => setImgWidth("60%"),
              <span className="pm-rte-txt">M</span>
            )}
            {btn(
              t("pm.rte.imgFull"),
              () => setImgWidth("100%"),
              <span className="pm-rte-txt">L</span>
            )}
          </>
        )}
        <span className="pm-rte-hint">{t("pm.rte.hint")}</span>
      </div>
      <div
        ref={ref}
        className="pm-rte-body"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder ?? t("pm.rte.placeholder")}
        onInput={emit}
        onBlur={() => {
          emit();
          if (selImgRef.current) selectImg(null);
        }}
        onClick={onBodyClick}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
      />
    </div>
  );
}
