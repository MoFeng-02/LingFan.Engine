/**
 * 04 §一 结构化作用域：块/列级变量层（父链查找，替代灵泛字符串键拼接 hack）。
 * 全局层 = 执行器 SSOT Map 本体（04-S3：块/列级不进存档，故不落 SSOT）。
 * 出域销毁 = 丢弃子 Scope 对象；undef = 沿父链删除声明槽。
 */
export class Scope {
  private readonly vars = new Map<string, unknown>();

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

  /** 写入「声明时所在层」（04 §一.4 block-scoped 语义）；未声明过 → false（由调用方决定报错或落全局） */
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

  /** undef：沿父链删除声明槽（04 §一.5，等价灵泛清同名 _local_ 键）；找到并删除 → true */
  undef(name: string): boolean {
    if (this.vars.has(name)) {
      this.vars.delete(name);
      return true;
    }
    return this.parent?.undef(name) ?? false;
  }

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
}
