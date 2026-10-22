类型体操这个词听起来很吓人，但把常用工具类型的实现挨个拆开看一遍，会发现它其实只有三个基本动作：**读取属性、构造新类型、在类型层面做判断**。

## 从最简单的 Partial 开始

`Partial<T>` 的作用是把所有属性变成可选：

~~~ts
type MyPartial<T> = {
  [K in keyof T]?: T[K];
};
~~~

这里出现了两个关键字：

- `keyof T` 拿到 T 的所有键组成的联合类型
- `[K in ...]` 表示遍历这个联合类型，也就是映射类型

理解了这个模式，`Required`、`Readonly` 都是一样的结构，只是修饰符不同：

~~~ts
type MyRequired<T> = { [K in keyof T]-?: T[K] };
type MyReadonly<T> = { readonly [K in keyof T]: T[K] };
~~~

> [!TIP]
> `-?` 表示移除可选修饰符，对应的还有 `-readonly` 用来移除只读修饰符。加号可以省略，减号不行。

## 用条件类型做「类型层面 if」

条件类型的写法是 `A extends B ? X : Y`，读作「如果 A 可以赋值给 B」。

~~~ts
type IsString<T> = T extends string ? true : false;
~~~

这里有一个很容易踩的坑：**当 T 是联合类型时，条件类型会分发**。

~~~ts
type Result = IsString<'a' | 1>; // boolean
~~~

因为 `'a' | 1` 被拆成两个分支分别判断，最后结果是 `true | false`。

如果不想分发，可以用方括号包一层：

~~~ts
type NoDistribute<T> = [T] extends [string] ? true : false;
type Result = NoDistribute<'a' | 1>; // false
~~~

## 从数组里推导类型

`infer` 只在条件类型里出现，用来「临时命名」一个待推导的类型：

~~~ts
type ElementOf<T> = T extends (infer U)[] ? U : never;

type A = ElementOf<string[]>;        // string
type B = ElementOf<[1, 'a', true]>;  // 1 | 'a' | true
~~~

基于这个可以写出 `Promise` 的解包：

~~~ts
type Awaited2<T> = T extends Promise<infer U> ? U : T;
~~~

## 递归：处理嵌套结构

把嵌套的只读类型全部展开，需要递归：

~~~ts
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object
    ? T[K] extends Function
      ? T[K]
      : DeepReadonly<T[K]>
    : T[K];
};
~~~

> [!WARNING]
> 递归类型要注意深度。TypeScript 有递归层数限制，处理超深的对象树时可能报 `Type instantiation is excessively deep`。

## 一个实际用到的例子

给接口定义写一个「查询结果永远不为 null」的转换：

~~~ts
type NonNullish<T> = {
  [K in keyof T]: NonNullable<T[K]>;
};

interface User {
  id: number;
  nickname: string | null;
  email: string | null;
}

type SafeUser = NonNullish<User>;
// { id: number; nickname: string; email: string }
~~~

## 小结

| 关键字 | 用途 |
| --- | --- |
| `keyof` | 取键的联合类型 |
| `in` | 遍历联合类型（映射类型） |
| `extends` | 条件判断 / 约束 |
| `infer` | 在条件类型中推导类型 |
| `-?` `-readonly` | 移除修饰符 |

写类型体操时，我习惯先**用具体类型手算一遍**结果，再写泛型版本。直接用泛型推导，很容易在分发和递归上绕晕。

> [!NOTE]
> 类型体操的价值在于「让调用方写错的代码无法通过编译」。如果一个复杂类型不能带来实际的约束收益，不如写一个简单的 interface。
