import { hasStartedWork } from "@/pm/utils/projectStatus";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import * as api from "./api";
import type {
  Customer,
  Dependency,
  Holiday,
  Member,
  Project,
  ProjectStatus,
  RoadmapOption,
  RoadmapOptionKind,
  Task,
  TaskStatus,
  Team,
} from "./types";
import { setHoursPerDay } from "./utils/date";
import { projectProgress } from "./utils/tree";

interface DataContextValue {
  members: Member[];
  customers: Customer[];
  projects: Project[];
  /** 当前租户团队列表（多团队；随 ensureBase 加载）。单团队租户长度为 1 */
  teams: Team[];
  memberMap: Record<string, Member>;
  customerMap: Record<string, Customer>;
  /** 基础数据（项目/客户/成员）是否已加载完成 */
  baseLoaded: boolean;
  /** 某项目的任务/依赖是否已加载 */
  isProjectLoaded: (projectId: string) => boolean;
  /** 拉取基础数据（幂等：仅首次真正请求） */
  ensureBase: () => Promise<void>;
  /** 重新拉取成员名册（自愈用：登录后基础数据偶发为空/过期被幂等缓存时强制刷新） */
  reloadMembers: () => Promise<void>;
  /** 拉取某项目的任务 + 依赖（幂等） */
  loadProject: (projectId: string) => Promise<void>;
  tasksOf: (projectId: string) => Task[];
  depsOf: (projectId: string) => Dependency[];
  addTask: (t: Omit<Task, "id">) => Promise<Task>;
  updateTask: (
    id: string,
    patch: Partial<Task> & {
      reparent?: boolean;
      clearActual?: boolean;
      clearActualEnd?: boolean;
      clearEffort?: boolean;
    }
  ) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  /** 看板：乐观更新某任务的业务状态（不影响 rollup，故不整树 refetch） */
  setTaskStatus: (id: string, status: TaskStatus) => Promise<void>;
  /** WBS 行内担当变更：乐观更新（不影响 rollup，故不整树 refetch） */
  setTaskAssignees: (id: string, assigneeIds: string[]) => Promise<void>;
  toggleCollapse: (id: string) => Promise<void>;
  setCollapsedAll: (projectId: string, collapsed: boolean) => Promise<void>;
  /** status は省略可（省略時は後端の既定値 planned） */
  addProject: (
    p: Omit<Project, "id" | "progress" | "status"> & { status?: ProjectStatus }
  ) => Promise<Project>;
  updateProject: (
    id: string,
    /** clearEnd=true で終了日を明示的に null（＝継続中）へ戻す。end:null は「未変更」と区別できないため */
    patch: Partial<Omit<Project, "id" | "progress">> & {
      clearEnd?: boolean;
      /** true=親から外してトップレベルへ戻す（parentId:null は「未変更」と区別できないため） */
      clearParent?: boolean;
    }
  ) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  /**
   * 拖动排序：持久化同一阶层的项目顺序。parentId 省略＝该客户的トップレベル同士、
   * 指定＝その親のサブ同士（階層をまたぐ並べ替えはしない）。
   */
  reorderProjects: (
    customerId: string,
    orderedIds: string[],
    parentId?: string | null
  ) => Promise<void>;
  addCustomer: (
    name: string,
    shortName?: string,
    teamId?: string,
    active?: boolean
  ) => Promise<Customer>;
  updateCustomer: (
    id: string,
    name: string,
    shortName?: string,
    active?: boolean
  ) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  // ===== 路线图字典（泳道 / 里程碑色，租户级） =====
  /** 当前租户字典项（随 ensureBase 加载） */
  roadmapOptions: RoadmapOption[];
  /** 某 kind 的字典项（已按 sortOrder 排序） */
  roadmapOptionsOf: (kind: RoadmapOptionKind) => RoadmapOption[];
  addRoadmapOption: (body: {
    kind: RoadmapOptionKind;
    label: string;
    color?: string | null;
  }) => Promise<RoadmapOption>;
  updateRoadmapOption: (
    id: string,
    body: { label?: string; color?: string | null }
  ) => Promise<void>;
  deleteRoadmapOption: (id: string) => Promise<void>;
  reorderRoadmapOptions: (
    kind: RoadmapOptionKind,
    orderedIds: string[]
  ) => Promise<void>;
  // ===== 节假日（红日子，租户级；工期/进度排除周末 + 这些日期） =====
  /** 红日子日期集合（ISO YYYY-MM-DD），随 ensureBase 加载；供工作日工期/进度排除 */
  holidays: Set<string>;
  /** 红日子完整列表（管理页用，按日期升序） */
  holidayList: Holiday[];
  addHoliday: (date: string, name: string) => Promise<void>;
  editHoliday: (id: string, date: string, name: string) => Promise<void>;
  removeHoliday: (id: string) => Promise<void>;
  importHolidays: (rows: { date: string; name: string }[]) => Promise<number>;
  syncHolidays: () => Promise<{
    added: number;
    updated: number;
    removed: number;
  }>;
  // ===== 工数设定（1営業日=何時間，租户级；工期↔時間の換算単位） =====
  /** 当前租户「1営業日=何時間」（既定 8），随 ensureBase 加载；供工期↔時間换算 */
  hoursPerWorkday: number;
  /** 更新「1営業日=何時間」（owner 限定，范围 [1,24]）；成功后即时同步换算单位 */
  updateHoursPerWorkday: (hours: number) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<string, Task[]>>(
    {}
  );
  const [depsByProject, setDepsByProject] = useState<
    Record<string, Dependency[]>
  >({});
  const [roadmapOptions, setRoadmapOptions] = useState<RoadmapOption[]>([]);
  const [holidayList, setHolidayList] = useState<Holiday[]>([]);
  // 1営業日=何時間（工期↔時間の換算単位）。既定 8；随 ensureBase 从租户设置加载。
  const [hoursPerWorkday, setHoursPerWorkdayState] = useState<number>(8);
  const [baseLoaded, setBaseLoaded] = useState(false);
  const [loadedProjects, setLoadedProjects] = useState<Set<string>>(
    () => new Set()
  );

  // 防止并发重复请求（Strict Mode 下 effect 会跑两次）
  const baseReq = useRef<Promise<void> | null>(null);
  const projReq = useRef<Map<string, Promise<void>>>(new Map());

  const memberMap = useMemo(
    () => Object.fromEntries(members.map((m) => [m.id, m])),
    [members]
  );
  const customerMap = useMemo(
    () => Object.fromEntries(customers.map((c) => [c.id, c])),
    [customers]
  );
  // 红日子日期集合（ISO YYYY-MM-DD）：工作日工期/进度排除用，随 holidayList 派生
  const holidays = useMemo(
    () => new Set(holidayList.map((h) => h.holidayDate)),
    [holidayList]
  );

  const ensureBase = useCallback(async () => {
    if (baseReq.current) return baseReq.current;
    baseReq.current = (async () => {
      const [ps, cs, ms, opts, hols, tms, wd] = await Promise.all([
        api.listProjects(),
        api.listCustomers(),
        api.listMembers(),
        api.listRoadmapOptions(),
        api.listHolidays(),
        api.listTeams().catch(() => [] as Team[]),
        api.getWorkdaySetting().catch(() => ({ hoursPerWorkday: 8 })),
      ]);
      setProjects(ps ?? []);
      setCustomers(cs ?? []);
      setMembers(ms ?? []);
      setRoadmapOptions(Array.isArray(opts) ? opts : []);
      setHolidayList(Array.isArray(hols) ? hols : []);
      setTeams(Array.isArray(tms) ? tms : []);
      // 工数设定：把租户「1営業日=何時間」注入换算单位（module 级），使工期↔時間全局按此换算
      const hpd = wd?.hoursPerWorkday ?? 8;
      setHoursPerWorkdayState(hpd);
      setHoursPerDay(hpd);
      setBaseLoaded(true);
    })().catch((e) => {
      baseReq.current = null; // 失败后允许重试
      throw e;
    });
    return baseReq.current;
  }, []);

  /**
   * 强制重拉成员名册（绕过 ensureBase 的幂等缓存）。
   * 用于自愈：登录后偶发 listMembers 返回空被永久缓存，导致担当显示成 UUID；
   * 检测到引用了未知成员 ID 时调用一次即可恢复真实姓名。
   */
  const reloadMembers = useCallback(async () => {
    const ms = await api.listMembers();
    setMembers(ms ?? []);
  }, []);

  /**
   * プロジェクト一覧を後端から取り直す（親の集計進捗など、後端でしか算出しない値の同期用）。
   * 背景での同期なので失敗は握りつぶす（エラー toast は request 側で出る）。
   */
  const refreshProjects = useCallback(async () => {
    try {
      const ps = await api.listProjects();
      setProjects(ps ?? []);
    } catch {
      /* 次回の操作で再同期される */
    }
  }, []);

  // サブプロジェクト判定を最新の一覧で行うための参照（コールバックの依存を増やさない）
  const projectsRef = useRef<Project[]>(projects);
  projectsRef.current = projects;

  /**
   * タスク変更後の進捗をキャッシュへ反映する。
   * - 通常：前端の rollup 値をそのまま入れる（後端と同口径）。
   * - サブを持つ親：自分のタスクだけの値は誤りなので入れない（後端の集計を取り直す）。
   * - サブ：自分は即時反映し、親の集計値を後端から取り直す。
   */
  const applyProjectProgress = useCallback(
    (projectId: string, prog: number, tasks: Task[]) => {
      const list = projectsRef.current;
      const isParent = list.some((p) => p.parentId === projectId);
      const isSub = !!list.find((p) => p.id === projectId)?.parentId;
      if (!isParent) {
        setProjects((prev) =>
          prev.map((p) => (p.id === projectId ? { ...p, progress: prog, hasStartedWork: hasStartedWork(tasks) } : p))
        );
      }
      if (isParent || isSub) void refreshProjects();
    },
    [refreshProjects]
  );

  /** 重新拉取某项目任务，并把项目列表里的进度同步为最新（与后端 rollup 一致） */
  const refetchTasks = useCallback(
    async (projectId: string) => {
      const tasks = await api.listTasks(projectId);
      setTasksByProject((prev) => ({ ...prev, [projectId]: tasks }));
      applyProjectProgress(projectId, projectProgress(tasks, holidays), tasks);
    },
    [holidays, applyProjectProgress]
  );

  const loadProject = useCallback(
    async (projectId: string) => {
      if (loadedProjects.has(projectId)) return;
      const inflight = projReq.current.get(projectId);
      if (inflight) return inflight;
      const p = (async () => {
        const [tasks, deps] = await Promise.all([
          api.listTasks(projectId),
          api.listDependencies(projectId),
        ]);
        setTasksByProject((prev) => ({ ...prev, [projectId]: tasks }));
        applyProjectProgress(projectId, projectProgress(tasks, holidays), tasks);
        setDepsByProject((prev) => ({ ...prev, [projectId]: deps ?? [] }));
        setLoadedProjects((prev) => new Set(prev).add(projectId));
      })().finally(() => {
        projReq.current.delete(projectId);
      });
      projReq.current.set(projectId, p);
      return p;
    },
    [loadedProjects, holidays, applyProjectProgress]
  );

  const value = useMemo<DataContextValue>(() => {
    const tasksOf = (projectId: string) => tasksByProject[projectId] ?? [];
    const depsOf = (projectId: string) => depsByProject[projectId] ?? [];

    return {
      members,
      customers,
      projects,
      teams,
      memberMap,
      customerMap,
      baseLoaded,
      isProjectLoaded: (projectId) => loadedProjects.has(projectId),
      ensureBase,
      reloadMembers,
      loadProject,
      tasksOf,
      depsOf,

      addProject: async (p) => {
        const created = await api.createProject({
          customerId: p.customerId,
          name: p.name,
          description: p.description,
          status: p.status,
          kind: p.kind,
          start: p.start,
          end: p.end,
          monthlyQuotaMinutes: p.monthlyQuotaMinutes,
          parentId: p.parentId ?? undefined,
        });
        if (created.parentId) {
          // サブ：一覧の末尾（同じ親のサブの最後）に足し、親の集計進捗は後端から取り直す
          setProjects((prev) => [...prev, created]);
          void refreshProjects();
        } else {
          setProjects((prev) => [created, ...prev]);
        }
        return created;
      },

      updateProject: async (id, patch) => {
        const before = projects.find((p) => p.id === id);
        const updated = await api.updateProject(id, patch);
        setProjects((prev) =>
          prev.map((p) => (p.id === id ? { ...p, ...updated, hasStartedWork: updated.hasStartedWork ?? p.hasStartedWork } : p))
        );
        // 親子が絡む更新（付け替え・サブの期間変更・親の顧客変更でサブ追従）は
        // 後端で並び順 / 親の集計 / サブの顧客が変わるので一覧ごと取り直す
        const involvesHierarchy =
          !!before?.parentId ||
          !!updated.parentId ||
          projects.some((p) => p.parentId === id);
        if (involvesHierarchy) void refreshProjects();
      },

      deleteProject: async (id) => {
        const wasSub = !!projects.find((p) => p.id === id)?.parentId;
        await api.deleteProject(id);
        setProjects((prev) => prev.filter((p) => p.id !== id));
        if (wasSub) void refreshProjects();   // 親の集計進捗が変わる
        setTasksByProject((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setDepsByProject((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setLoadedProjects((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      },

      reorderProjects: async (customerId, orderedIds, parentId) => {
        const snapshot = projects;
        // 同じ顧客・同じ親の案件だけを並べ替え、他の階層の順序は維持する。
        const sameLevel = (p: Project) =>
          p.customerId === customerId &&
          (p.parentId ?? null) === (parentId ?? null);
        const pos = new Map(orderedIds.map((id, i) => [id, i] as const));
        const ordered = projects
          .filter(sameLevel)
          .map((p) => ({
            ...p,
            sortOrder: pos.has(p.id) ? (pos.get(p.id) as number) : p.sortOrder,
          }))
          .sort(
            (a, b) =>
              (pos.get(a.id) ?? a.sortOrder ?? 0) -
              (pos.get(b.id) ?? b.sortOrder ?? 0)
          );
        let i = 0;
        setProjects((prev) =>
          prev.map((p) => (sameLevel(p) ? ordered[i++] : p))
        );
        try {
          await api.reorderProjects(customerId, orderedIds, parentId);
        } catch (e) {
          setProjects(snapshot); // 失败回滚
          throw e;
        }
      },

      addCustomer: async (name, shortName, teamId, active) => {
        const created = await api.createCustomer(
          name,
          shortName,
          teamId,
          active
        );
        setCustomers((prev) => [...prev, created]);
        return created;
      },

      updateCustomer: async (id, name, shortName, active) => {
        const updated = await api.updateCustomer(id, name, shortName, active);
        setCustomers((prev) => prev.map((c) => (c.id === id ? updated : c)));
      },

      deleteCustomer: async (id) => {
        await api.deleteCustomer(id);
        setCustomers((prev) => prev.filter((c) => c.id !== id));
      },

      roadmapOptions,
      roadmapOptionsOf: (kind) =>
        (Array.isArray(roadmapOptions) ? roadmapOptions : [])
          .filter((o) => o.kind === kind)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),

      addRoadmapOption: async (body) => {
        const created = await api.createRoadmapOption(body);
        setRoadmapOptions((prev) => [...prev, created]);
        return created;
      },

      updateRoadmapOption: async (id, body) => {
        const updated = await api.updateRoadmapOption(id, body);
        setRoadmapOptions((prev) =>
          prev.map((o) => (o.id === id ? updated : o))
        );
      },

      deleteRoadmapOption: async (id) => {
        await api.deleteRoadmapOption(id);
        setRoadmapOptions((prev) => prev.filter((o) => o.id !== id));
      },

      reorderRoadmapOptions: async (kind, orderedIds) => {
        const snapshot = roadmapOptions;
        // 乐观重排：仅调整该 kind 下的相对顺序
        const pos = new Map(orderedIds.map((id, i) => [id, i] as const));
        setRoadmapOptions((prev) =>
          prev.map((o) =>
            o.kind === kind && pos.has(o.id)
              ? { ...o, sortOrder: pos.get(o.id) as number }
              : o
          )
        );
        try {
          await api.reorderRoadmapOptions(kind, orderedIds);
        } catch (e) {
          setRoadmapOptions(snapshot); // 失败回滚
          throw e;
        }
      },

      holidays,
      holidayList,

      addHoliday: async (date, name) => {
        const created = await api.createHoliday({ date, name });
        setHolidayList((prev) =>
          [...prev, created].sort((a, b) =>
            a.holidayDate < b.holidayDate ? -1 : 1
          )
        );
      },

      editHoliday: async (id, date, name) => {
        const updated = await api.updateHoliday(id, { date, name });
        setHolidayList((prev) =>
          prev
            .map((h) => (h.id === id ? updated : h))
            .sort((a, b) => (a.holidayDate < b.holidayDate ? -1 : 1))
        );
      },

      removeHoliday: async (id) => {
        await api.deleteHoliday(id);
        setHolidayList((prev) => prev.filter((h) => h.id !== id));
      },

      importHolidays: async (rows) => {
        const added = await api.importHolidays(rows);
        if (added > 0) {
          const fresh = await api.listHolidays();
          setHolidayList(Array.isArray(fresh) ? fresh : []);
        }
        return added;
      },

      syncHolidays: async () => {
        const result = await api.syncHolidays();
        const fresh = await api.listHolidays();
        setHolidayList(Array.isArray(fresh) ? fresh : []);
        return result;
      },

      hoursPerWorkday,

      updateHoursPerWorkday: async (hours) => {
        const res = await api.updateWorkdaySetting(hours);
        const hpd = res?.hoursPerWorkday ?? hours;
        setHoursPerWorkdayState(hpd);
        setHoursPerDay(hpd); // 即时同步换算单位，无需刷新页面
      },

      addTask: async (t) => {
        const created = await api.createTask({
          projectId: t.projectId,
          parentId: t.parentId,
          name: t.name,
          start: t.start,
          end: t.end,
          actualStart: t.actualStart,
          actualEnd: t.actualEnd,
          plannedEffortHours: t.plannedEffortHours,
          actualEffortHours: t.actualEffortHours,
          plannedEffortDays: t.plannedEffortDays,
          actualEffortDays: t.actualEffortDays,
          progress: t.progress,
          assigneeIds: t.assigneeIds,
          levels: t.levels,
          description: t.description,
          type: t.type,
          status: t.status,
          collapsed: t.collapsed,
          order: t.order,
          roadmapVisible: t.roadmapVisible,
          roadmapLane: t.roadmapLane,
          milestoneColor: t.milestoneColor,
        });
        await refetchTasks(t.projectId);
        return created;
      },

      updateTask: async (id, patch) => {
        // 记录原项目：跨项目移动后需同时刷新新旧两端的任务与依赖
        let oldProjectId: string | undefined;
        for (const [pid, list] of Object.entries(tasksByProject)) {
          if (list.some((t) => t.id === id)) {
            oldProjectId = pid;
            break;
          }
        }
        const updated = await api.updateTask(id, patch);
        await refetchTasks(updated.projectId);
        if (oldProjectId && oldProjectId !== updated.projectId) {
          const old = oldProjectId;
          await refetchTasks(old);
          // FS 依赖连线随子树迁移/跨边界删除 → 两端依赖都要重取
          const [oldDeps, newDeps] = await Promise.all([
            api.listDependencies(old),
            api.listDependencies(updated.projectId),
          ]);
          setDepsByProject((prev) => ({
            ...prev,
            [old]: oldDeps ?? [],
            [updated.projectId]: newDeps ?? [],
          }));
        }
      },

      deleteTask: async (id) => {
        // 找到所属项目（删除后需刷新该项目的任务 + 依赖）
        let projectId: string | undefined;
        for (const [pid, list] of Object.entries(tasksByProject)) {
          if (list.some((t) => t.id === id)) {
            projectId = pid;
            break;
          }
        }
        await api.deleteTask(id);
        if (projectId) {
          const pid = projectId;
          const [tasks, deps] = await Promise.all([
            api.listTasks(pid),
            api.listDependencies(pid),
          ]);
          setTasksByProject((prev) => ({ ...prev, [pid]: tasks }));
          setDepsByProject((prev) => ({ ...prev, [pid]: deps ?? [] }));
          applyProjectProgress(pid, projectProgress(tasks, holidays), tasks);
        }
      },

      setTaskStatus: async (id, status) => {
        // 乐观更新看板状态；成功后同步0%任务的已开始标记及父项目。
        // 仅定位到所属项目并函数式更新/回滚目标任务，避免整 map 快照覆盖误伤
        // await 期间其它项目的并发 refetch。
        let pid: string | undefined;
        let prevStatus: TaskStatus | undefined;
        for (const [p, list] of Object.entries(tasksByProject)) {
          const found = list.find((t) => t.id === id);
          if (found) {
            pid = p;
            prevStatus = found.status;
            break;
          }
        }
        if (!pid) {
          await api.updateTask(id, { status });
          await refreshProjects();
          return;
        }
        const projectId = pid;
        setTasksByProject((prev) => ({
          ...prev,
          [projectId]: (prev[projectId] ?? []).map((t) =>
            t.id === id ? { ...t, status } : t
          ),
        }));
        try {
          await api.updateTask(id, { status });
        } catch (e) {
          // 仅回滚目标任务状态
          setTasksByProject((prev) => ({
            ...prev,
            [projectId]: (prev[projectId] ?? []).map((t) =>
              t.id === id ? { ...t, status: prevStatus as TaskStatus } : t
            ),
          }));
          throw e;
        }
        // Keep outside the mutation catch: a read failure must not pretend the
        // successful server-side status change was rolled back.
        await refetchTasks(projectId);
      },

      setTaskAssignees: async (id, assigneeIds) => {
        // 担当は progress/rollup に影響しないので、setTaskStatus と同様に
        // 楽観更新のみ（PUT の往復を待って refetch すると、選択の反映が
        // 目に見えて遅れる）。失敗時は対象タスクだけ元に戻す。
        let pid: string | undefined;
        let prevIds: string[] | undefined;
        for (const [p, list] of Object.entries(tasksByProject)) {
          const found = list.find((t) => t.id === id);
          if (found) {
            pid = p;
            prevIds = found.assigneeIds;
            break;
          }
        }
        if (!pid) {
          await api.updateTask(id, { assigneeIds });
          return;
        }
        const projectId = pid;
        const patchIds = (ids: string[]) => (prev: Record<string, Task[]>) => ({
          ...prev,
          [projectId]: (prev[projectId] ?? []).map((t) =>
            t.id === id ? { ...t, assigneeIds: ids } : t
          ),
        });
        setTasksByProject(patchIds(assigneeIds));
        try {
          await api.updateTask(id, { assigneeIds });
        } catch (e) {
          setTasksByProject(patchIds(prevIds ?? []));
          throw e;
        }
      },

      toggleCollapse: async (id) => {
        // 乐观更新折叠态（纯 UI，不影响 rollup）；定位所属项目局部更新，失败回滚
        let pid: string | undefined;
        for (const [p, list] of Object.entries(tasksByProject)) {
          if (list.some((t) => t.id === id)) {
            pid = p;
            break;
          }
        }
        if (!pid) {
          await api.toggleCollapse(id);
          return;
        }
        const projectId = pid;
        const flip = (prev: Record<string, Task[]>) => ({
          ...prev,
          [projectId]: (prev[projectId] ?? []).map((t) =>
            t.id === id ? { ...t, collapsed: !t.collapsed } : t
          ),
        });
        setTasksByProject(flip);
        try {
          await api.toggleCollapse(id);
        } catch (e) {
          setTasksByProject(flip); // 再翻转一次=回滚到原折叠态
          throw e;
        }
      },

      setCollapsedAll: async (projectId, collapsed) => {
        setTasksByProject((prev) => ({
          ...prev,
          [projectId]: (prev[projectId] ?? []).map((t) =>
            t.type === "summary" ? { ...t, collapsed } : t
          ),
        }));
        await api.setCollapsedAll(projectId, collapsed);
      },
    };
  }, [
    members,
    customers,
    projects,
    teams,
    memberMap,
    customerMap,
    baseLoaded,
    loadedProjects,
    tasksByProject,
    depsByProject,
    roadmapOptions,
    holidays,
    holidayList,
    hoursPerWorkday,
    ensureBase,
    reloadMembers,
    loadProject,
    refetchTasks,
    refreshProjects,
    applyProjectProgress,
  ]);

  return <DataContext value={value}>{children}</DataContext>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}

/**
 * 取项目实时整体进度。
 * - 甘特页：该项目任务已加载 → 用任务实时汇总（编辑后立即反映）。
 * - 列表页：任务未按项目加载 → 用后端缓存的 project.progress。
 */
export function useProjectProgress(projectId: string): number {
  const { tasksOf, projects, isProjectLoaded, holidays } = useData();
  const tasks = tasksOf(projectId);
  const stored = projects.find((p) => p.id === projectId)?.progress ?? 0;
  const loaded = isProjectLoaded(projectId);
  // サブプロジェクトを持つ親は「サブ＋親直下タスク」の加重集計（後端算出）が正なので、
  // 自分のタスクだけで再計算せず後端の値を使う
  const isParent = projects.some((p) => p.parentId === projectId);
  return useMemo(
    () => (loaded && !isParent ? projectProgress(tasks, holidays) : stored),
    [loaded, isParent, tasks, stored, holidays]
  );
}

/**
 * 取项目实时周期（起止日期）。
 * - 甘特页：任务已加载且有任务 → 用任务最早 start ~ 最晚 end 实时推导（编辑后立即反映）。
 * - 否则（列表页 / 空项目）→ 回退到后端存储的 project.start/end 计划周期。
 * 与 {@link useProjectProgress} 同源：项目周期始终跟随实际排期。
 */
export function useProjectRange(projectId: string): {
  start: string;
  end: string;
} {
  const { tasksOf, projects, isProjectLoaded } = useData();
  const tasks = tasksOf(projectId);
  const project = projects.find((p) => p.id === projectId);
  const loaded = isProjectLoaded(projectId);
  return useMemo(() => {
    const fallback = { start: project?.start ?? "", end: project?.end ?? "" };
    if (!loaded || tasks.length === 0) return fallback;
    let start = tasks[0].start;
    let end = tasks[0].end;
    for (const t of tasks) {
      if (t.start < start) start = t.start;
      if (t.end > end) end = t.end;
    }
    return { start, end };
  }, [loaded, tasks, project?.start, project?.end]);
}
