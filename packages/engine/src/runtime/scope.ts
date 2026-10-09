/**
 * 结构化作用域：块/列级变量层（父链查找，替代字符串键拼接 hack）。
 * 全局层 = 执行器 SSOT Map 本体（块/列级不进存档，故不落 SSOT）。
 * 出域销毁 = 丢弃子 Scope 对象；undef = 沿父链删除声明槽。
 */
export class Scope {
  /** 本层变量表；名字只在声明层可见，子层同名写入落哪一层由 assignExisting 决定 */
  private readonly vars = new Map<string, unknown>();

  /** @param parent 父层（链根传 null）；构造私有，只能经 root/enterChild 建链 */
  private constructor(private readonly parent: Scope | null) {}

  /** 新作用域链的根（执行器中即「列级」层） */
  static root(): Scope {
    return new Scope(null);
  }

  /** 进入子作用域（块级：if 体等；出块 = 不再引用返回值） */
  enterChild(): Scope {
    return new Scope(this);
  }

  /** 沿父链查找（块 → 列 → …） */
  lookup(name: string): { found: true; value: unknown } | { found: false } {
    if (this.vars.has(name)) return { found: true, value: this.vars.get(name) };
    return this.parent?.lookup(name) ?? { found: false };
  }

  /** 写入「声明时所在层」（block-scoped 语义）；未声明过 → false（由调用方决定报错或落全局） */
  assignExisting(name: string, value: unknown): boolean {
    if (this.vars.has(name)) {
      this.vars.set(name, value);
      return true;
    }
    return this.parent?.assignExisting(name, value) ?? false;
  }

  /** 在本层声明（let/local：块级可变） */
  declare(name: string, value: unknown): void {
    this.vars.set(name, value);
  }

  /** undef：沿父链删除声明槽；找到并删除 → true */
  undef(name: string): boolean {
    if (this.vars.has(name)) {
      this.vars.delete(name);
      return true;
    }
    return this.parent?.undef(name) ?? false;
  }

  /** 只看本层有没有该名字（不沿父链），用于区分「本层未声明」与「整条链上都没有」 */
  hasOwn(name: string): boolean {
    return this.vars.has(name);
  }

  /** 深拷贝作用域链（03 历史检查点：帧栈快照需独立副本，回溯恢复后互不串扰） */
  static cloneDeep(source: Scope | null): Scope {
    if (source === null) return Scope.root();
    const copy = new Scope(Scope.cloneDeep(source.parent));
    for (const [k, v] of source.vars) copy.vars.set(k, v);
    return copy;
  }

  /**
   * 作用域链变量快照（自叶向根，逐层复制本层变量）；配合 [`restoreChain`] 做原子回滚。
   * 只快照既有层对象——回滚前提是层链结构不变（调用方不得增删层）。
   */
  snapshotChain(): Array<Map<string, unknown>> {
    const out: Array<Map<string, unknown>> = [new Map(this.vars)];
    let rest = this.parent;
    while (rest !== null) {
      out.push(new Map(rest.vars));
      rest = rest.parentOf();
    }
    return out;
  }

  /** 原子回滚：按 [`snapshotChain`] 的层序写回各层变量（层对象本身不变，故父链保持） */
  restoreChain(snapshot: ReadonlyArray<ReadonlyMap<string, unknown>>): void {
    const first = snapshot[0];
    if (first !== undefined) this.replaceVars(first);
    let rest = this.parent;
    for (const vars of snapshot.slice(1)) {
      if (rest === null) return;
      rest.replaceVars(vars);
      rest = rest.parentOf();
    }
  }

  /** 本层变量整体替换（回滚用：层对象不变，只换内容） */
  private replaceVars(vars: ReadonlyMap<string, unknown>): void {
    this.vars.clear();
    for (const [k, v] of vars) this.vars.set(k, v);
  }

  /** 父层读取（回滚遍历用） */
  private parentOf(): Scope | null {
    return this.parent;
  }
}
