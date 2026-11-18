import type { PmDoc, Task } from "../types";
import {
  DOC_TYPE_CHIPS,
  GOOGLE_FOLDER_MIME,
  docDefaultNameKey,
  docDisplayName,
  docFileType,
  fileTypeFromMime,
  mergePicked,
  pickedAsDocSource,
  pickedFromPickerDoc,
  pickedToBatchItems,
  extOf,
  filterDocs,
  groupDocsByProject,
  hintDocUrl,
  taskPathOptions,
} from "./doc";

function doc(p: Partial<PmDoc>): PmDoc {
  return {
    id: "d",
    customerId: "c1",
    projectId: null,
    projectName: null,
    url: "https://example.com/",
    provider: "other",
    kind: "link",
    externalId: null,
    previewUrl: null,
    title: null,
    isRoot: false,
    mimeType: null,
    tasks: [],
    createdBy: "u1",
    createdByName: "山田",
    createdAt: "2026-10-15T00:00:00Z",
    ...p,
  };
}

describe("hintDocUrl", () => {
  it("recognizes Google native docs", () => {
    expect(
      hintDocUrl("https://docs.google.com/spreadsheets/d/abc_DEF-1/edit#gid=0")
    ).toEqual({ provider: "google", kind: "gsheet", previewable: true });
    expect(hintDocUrl("https://docs.google.com/document/d/x1/edit")?.kind).toBe(
      "gdoc"
    );
    expect(
      hintDocUrl("https://docs.google.com/presentation/d/x1/view")?.kind
    ).toBe("gslide");
  });

  it("recognizes Drive files and folders", () => {
    expect(hintDocUrl("https://drive.google.com/file/d/F1/view")?.kind).toBe(
      "gfile"
    );
    expect(hintDocUrl("https://drive.google.com/open?id=F1")?.kind).toBe(
      "gfile"
    );
    expect(hintDocUrl("https://drive.google.com/uc?id=F1")?.kind).toBe("gfile");
    expect(
      hintDocUrl("https://drive.google.com/drive/folders/FOLDER1")?.kind
    ).toBe("gfolder");
    expect(
      hintDocUrl("https://drive.google.com/drive/u/1/folders/FOLDER1")?.kind
    ).toBe("gfolder");
  });

  it("degrades google URLs without an id to a non-previewable link", () => {
    expect(hintDocUrl("https://drive.google.com/drive/my-drive")).toEqual({
      provider: "google",
      kind: "link",
      previewable: false,
    });
    expect(hintDocUrl("https://drive.google.com/open?id=bad id")?.kind).toBe(
      "link"
    );
  });

  it("recognizes Microsoft / Box / other", () => {
    expect(
      hintDocUrl("https://contoso.sharepoint.com/:x:/s/team/abc")?.provider
    ).toBe("microsoft");
    expect(hintDocUrl("https://1drv.ms/x/s!abc")?.kind).toBe("ms");
    expect(hintDocUrl("https://app.box.com/s/xyz")?.provider).toBe("box");
    expect(hintDocUrl("https://box.com/s/xyz")?.kind).toBe("box");
    expect(hintDocUrl("https://example.com/a.pdf")).toEqual({
      provider: "other",
      kind: "link",
      previewable: false,
    });
  });

  it("rejects non-http input", () => {
    expect(hintDocUrl("")).toBeNull();
    expect(hintDocUrl("not a url")).toBeNull();
    expect(hintDocUrl("javascript:alert(1)")).toBeNull();
    expect(hintDocUrl("ftp://example.com/a")).toBeNull();
  });
});

describe("extOf / docFileType", () => {
  it("extracts extensions", () => {
    expect(extOf("仕様書.XLSX")).toBe("xlsx");
    expect(extOf("/a/b/c.pdf?x=1")).toBe("pdf");
    expect(extOf("README")).toBeNull();
    expect(extOf(null)).toBeNull();
  });

  it("uses kind for Google native formats", () => {
    expect(docFileType(doc({ kind: "gsheet", title: "a.pdf" }))).toBe("xls");
    expect(docFileType(doc({ kind: "gdoc" }))).toBe("doc");
    expect(docFileType(doc({ kind: "gslide" }))).toBe("ppt");
    expect(docFileType(doc({ kind: "gfolder" }))).toBe("folder");
  });

  it("falls back to title, then URL extension", () => {
    expect(docFileType(doc({ kind: "gfile", title: "見積書.pdf" }))).toBe("pdf");
    expect(docFileType(doc({ kind: "gfile", title: "画面.PNG" }))).toBe("img");
    expect(
      docFileType(
        doc({ kind: "link", url: "https://example.com/files/%E8%A1%A8.xlsx" })
      )
    ).toBe("xls");
    expect(docFileType(doc({ kind: "gfile", title: "メモ" }))).toBe("file");
    expect(docFileType(doc({ kind: "ms" }))).toBe("file");
    expect(docFileType(doc({ kind: "link" }))).toBe("link");
  });
});

describe("docDisplayName", () => {
  it("prefers title, then file name, then host", () => {
    expect(docDisplayName(doc({ title: " 要件定義 " }))).toBe("要件定義");
    expect(
      docDisplayName(doc({ url: "https://example.com/a/%E8%A6%8B%E7%A9%8D.pdf" }))
    ).toBe("見積.pdf");
    expect(
      docDisplayName(doc({ url: "https://www.example.com/drive/folders/x" }))
    ).toBe("example.com");
  });
});

describe("filterDocs", () => {
  const docs = [
    doc({ id: "1", title: "要件定義.pdf" }),
    doc({
      id: "2",
      kind: "gsheet",
      title: "テスト項目",
      tasks: [{ taskId: "t1", taskName: "結合テスト" }],
    }),
    doc({ id: "3", url: "https://example.com/logo.png" }),
  ];
  it("filters by keyword over name, url and task names", () => {
    expect(filterDocs(docs, "要件").map((d) => d.id)).toEqual(["1"]);
    expect(filterDocs(docs, "結合").map((d) => d.id)).toEqual(["2"]);
    expect(filterDocs(docs, "LOGO").map((d) => d.id)).toEqual(["3"]);
    expect(filterDocs(docs, "  ").length).toBe(3);
  });
  it("filters by type", () => {
    expect(filterDocs(docs, "", "xls").map((d) => d.id)).toEqual(["2"]);
    expect(filterDocs(docs, "", "img").map((d) => d.id)).toEqual(["3"]);
    expect(filterDocs(docs, "要件", "img")).toEqual([]);
  });
});

describe("groupDocsByProject", () => {
  it("puts customer-common first and keeps project order", () => {
    const groups = groupDocsByProject([
      doc({ id: "a", projectId: "p2", projectName: "B 案件" }),
      doc({ id: "b" }),
      doc({ id: "c", projectId: "p1", projectName: "A 案件" }),
      doc({ id: "d", projectId: "p2", projectName: "B 案件" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["common", "p2", "p1"]);
    expect(groups[1].docs.map((d) => d.id)).toEqual(["a", "d"]);
    expect(groups[1].projectName).toBe("B 案件");
  });
  it("omits an empty common group", () => {
    expect(
      groupDocsByProject([doc({ projectId: "p1" })]).map((g) => g.key)
    ).toEqual(["p1"]);
    expect(groupDocsByProject([])).toEqual([]);
  });
});

describe("taskPathOptions", () => {
  const task = (
    id: string,
    name: string,
    parentId: string | null,
    order: number
  ) => ({ id, name, parentId, order, projectId: "p1" }) as unknown as Task;

  it("orders depth-first by order and builds WBS paths", () => {
    const opts = taskPathOptions([
      task("t2", "画面設計", "s1", 1),
      task("s2", "テスト", null, 1),
      task("t1", "API 設計", "s1", 0),
      task("s1", "設計", null, 0),
      task("t3", "結合テスト", "s2", 0),
    ]);
    expect(opts.map((o) => o.id)).toEqual(["s1", "t1", "t2", "s2", "t3"]);
    expect(opts[2]).toEqual({
      id: "t2",
      name: "画面設計",
      path: "設計 / 画面設計",
      depth: 1,
    });
  });

  it("treats orphans as roots", () => {
    const opts = taskPathOptions([task("x", "孤児", "missing", 0)]);
    expect(opts).toEqual([{ id: "x", name: "孤児", path: "孤児", depth: 0 }]);
  });
});

describe("fileTypeFromMime / docFileType with mimeType", () => {
  it("maps Google native and Office mime types", () => {
    expect(fileTypeFromMime(GOOGLE_FOLDER_MIME)).toBe("folder");
    expect(fileTypeFromMime("application/vnd.google-apps.spreadsheet")).toBe(
      "xls"
    );
    expect(fileTypeFromMime("application/vnd.google-apps.document")).toBe(
      "doc"
    );
    expect(fileTypeFromMime("application/vnd.google-apps.presentation")).toBe(
      "ppt"
    );
    expect(fileTypeFromMime("application/pdf")).toBe("pdf");
    expect(
      fileTypeFromMime(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBe("xls");
    expect(
      fileTypeFromMime(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe("doc");
    expect(
      fileTypeFromMime(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      )
    ).toBe("ppt");
    expect(fileTypeFromMime("application/vnd.ms-excel")).toBe("xls");
    expect(fileTypeFromMime("application/msword")).toBe("doc");
    expect(fileTypeFromMime("application/vnd.ms-powerpoint")).toBe("ppt");
    expect(fileTypeFromMime("image/png")).toBe("img");
    expect(fileTypeFromMime("IMAGE/JPEG")).toBe("img");
    expect(fileTypeFromMime("text/csv; charset=utf-8")).toBe("xls");
  });

  it("returns null for unknown / empty", () => {
    expect(fileTypeFromMime(null)).toBeNull();
    expect(fileTypeFromMime(undefined)).toBeNull();
    expect(fileTypeFromMime("")).toBeNull();
    expect(fileTypeFromMime("application/zip")).toBeNull();
  });

  it("mimeType wins over kind and extension", () => {
    // Drive 上の Excel だが名前に拡張子が無い → mimeType で xls
    expect(
      docFileType(
        doc({
          kind: "gfile",
          title: "見積",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
      )
    ).toBe("xls");
    expect(
      docFileType(
        doc({ kind: "gfile", title: "a.docx", mimeType: "application/pdf" })
      )
    ).toBe("pdf");
  });

  it("falls back to kind / extension when mimeType is unknown", () => {
    expect(
      docFileType(
        doc({ kind: "gsheet", mimeType: "application/octet-stream" })
      )
    ).toBe("xls");
    expect(
      docFileType(
        doc({ kind: "gfile", title: "a.pdf", mimeType: "application/zip" })
      )
    ).toBe("pdf");
  });
});

describe("default display names", () => {
  const tr = (k: string) => `<${k}>`;

  it("root folders get a provider-specific folder name, not the hostname", () => {
    const root = doc({
      isRoot: true,
      provider: "google",
      kind: "gfolder",
      url: "https://drive.google.com/drive/folders/F1",
    });
    expect(docDefaultNameKey(root)).toBe("docs.defaultName.folder.google");
    expect(docDisplayName(root, tr)).toBe("<docs.defaultName.folder.google>");
    expect(
      docDisplayName(
        doc({
          isRoot: true,
          provider: "microsoft",
          kind: "ms",
          url: "https://acme.sharepoint.com/sites/x/Shared%20Documents/proj",
        }),
        tr
      )
    ).toBe("<docs.defaultName.folder.microsoft>");
    expect(
      docDefaultNameKey(
        doc({ isRoot: true, provider: "other", kind: "link" })
      )
    ).toBe("docs.defaultName.folder.other");
  });

  it("Google native / Drive file / SharePoint / Box get kind names", () => {
    const sheet = doc({
      provider: "google",
      kind: "gsheet",
      url: "https://docs.google.com/spreadsheets/d/S1/edit",
    });
    expect(docDisplayName(sheet, tr)).toBe("<docs.kind.gsheet>");
    expect(
      docDisplayName(
        doc({
          provider: "google",
          kind: "gfile",
          url: "https://drive.google.com/file/d/F1/view",
        }),
        tr
      )
    ).toBe("<docs.defaultName.gfile>");
    expect(docDefaultNameKey(doc({ provider: "box", kind: "box" }))).toBe(
      "docs.kind.box"
    );
  });

  it("title and file name in URL still win; generic links keep the hostname", () => {
    expect(
      docDisplayName(doc({ kind: "gfolder", isRoot: true, title: "案件A" }), tr)
    ).toBe("案件A");
    expect(
      docDisplayName(
        doc({ kind: "ms", provider: "microsoft", url: "https://x.sharepoint.com/a/仕様.xlsx" }),
        tr
      )
    ).toBe("仕様.xlsx");
    expect(
      docDisplayName(doc({ kind: "link", url: "https://www.example.com/x" }), tr)
    ).toBe("example.com");
  });

  it("without a translator behaves as before (hostname)", () => {
    expect(
      docDisplayName(
        doc({
          isRoot: true,
          kind: "gfolder",
          url: "https://drive.google.com/drive/folders/F1",
        })
      )
    ).toBe("drive.google.com");
  });
});

describe("DOC_TYPE_CHIPS", () => {
  it("lists すべて / PDF / Excel / Word / PowerPoint / 画像 in order (no folder chip)", () => {
    expect(DOC_TYPE_CHIPS).toEqual(["all", "pdf", "xls", "doc", "ppt", "img"]);
  });

  it("filters by the folder / ppt chip using mimeType too", () => {
    const docs = [
      doc({ id: "1", mimeType: GOOGLE_FOLDER_MIME, kind: "gfolder" }),
      doc({
        id: "2",
        kind: "gfile",
        mimeType: "application/vnd.ms-powerpoint",
        title: "提案",
      }),
      doc({ id: "3", kind: "gslide" }),
    ];
    expect(filterDocs(docs, "", "folder").map((d) => d.id)).toEqual(["1"]);
    expect(filterDocs(docs, "", "ppt").map((d) => d.id)).toEqual(["2", "3"]);
  });

  it("searches by the shown name when nameOf is given", () => {
    const docs = [
      doc({
        id: "1",
        kind: "gsheet",
        url: "https://docs.google.com/spreadsheets/d/S1/edit",
      }),
    ];
    expect(filterDocs(docs, "スプレッド")).toEqual([]);
    expect(
      filterDocs(docs, "スプレッド", "all", () => "Google スプレッドシート").map(
        (d) => d.id
      )
    ).toEqual(["1"]);
  });
});

describe("pickedFromPickerDoc", () => {
  it("prefers doc.url for files", () => {
    expect(
      pickedFromPickerDoc({
        id: "F1",
        name: " 見積.xlsx ",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        url: "https://docs.google.com/spreadsheets/d/F1/edit?usp=drive_web",
      })
    ).toEqual({
      id: "F1",
      name: "見積.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      url: "https://docs.google.com/spreadsheets/d/F1/edit?usp=drive_web",
    });
  });

  it("builds the folders URL for folders", () => {
    expect(
      pickedFromPickerDoc({
        id: "D_1-x",
        name: "案件A",
        mimeType: GOOGLE_FOLDER_MIME,
        url: "https://drive.google.com/drive/u/0/folders/D_1-x?usp=x",
      })?.url
    ).toBe("https://drive.google.com/drive/folders/D_1-x");
  });

  it("falls back to /file/d/{id}/view when url is missing or not http(s)", () => {
    expect(
      pickedFromPickerDoc({ id: "F2", name: "a.pdf", mimeType: "application/pdf" })
        ?.url
    ).toBe("https://drive.google.com/file/d/F2/view");
    expect(
      pickedFromPickerDoc({
        id: "F2",
        name: "a.pdf",
        mimeType: "application/pdf",
        url: "javascript:alert(1)",
      })?.url
    ).toBe("https://drive.google.com/file/d/F2/view");
  });

  it("drops items with an invalid id", () => {
    expect(pickedFromPickerDoc({ id: "../x", name: "a" })).toBeNull();
    expect(pickedFromPickerDoc({ name: "a" })).toBeNull();
  });
});

describe("pickedToBatchItems / mergePicked / pickedAsDocSource", () => {
  const f = (id: string, name: string, mimeType = "application/pdf") => ({
    id,
    name,
    mimeType,
    url: `https://drive.google.com/file/d/${id}/view`,
  });

  it("uses the edited title, then the file name; sends mimeType", () => {
    expect(
      pickedToBatchItems([
        { ...f("A", "a.pdf"), title: " 見積（最新） " },
        { ...f("B", "b.pdf"), title: "  " },
      ])
    ).toEqual([
      {
        url: "https://drive.google.com/file/d/A/view",
        title: "見積（最新）",
        mimeType: "application/pdf",
      },
      {
        url: "https://drive.google.com/file/d/B/view",
        title: "b.pdf",
        mimeType: "application/pdf",
      },
    ]);
  });

  it("omits empty title / mimeType and truncates long titles to 200", () => {
    const [item] = pickedToBatchItems([{ ...f("C", "", ""), title: "" }]);
    expect(item).toEqual({ url: "https://drive.google.com/file/d/C/view" });
    const [long] = pickedToBatchItems([{ ...f("D", "x".repeat(300)) }]);
    expect(long.title).toHaveLength(200);
  });

  it("dedupes by id and keeps the existing (renamed) row", () => {
    const cur = [{ ...f("A", "a.pdf"), title: "renamed" }];
    const merged = mergePicked(cur, [
      { ...f("A", "a.pdf"), title: "a.pdf" },
      { ...f("B", "b.pdf"), title: "b.pdf" },
    ]);
    expect(merged.map((x) => [x.id, x.title])).toEqual([
      ["A", "renamed"],
      ["B", "b.pdf"],
    ]);
  });

  it("maps picked files to icon sources", () => {
    expect(docFileType(pickedAsDocSource(f("F", "dir", GOOGLE_FOLDER_MIME)))).toBe(
      "folder"
    );
    expect(pickedAsDocSource(f("F", "dir", GOOGLE_FOLDER_MIME)).kind).toBe(
      "gfolder"
    );
    expect(docFileType(pickedAsDocSource(f("G", "notes")))).toBe("pdf");
  });
});
