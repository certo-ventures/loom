/**
 * WebAssembly global type definitions
 * Ensures TypeScript recognizes WebAssembly APIs
 */

declare namespace WebAssembly {
  interface Memory {
    readonly buffer: ArrayBuffer
    grow(delta: number): number
  }

  interface Instance {
    readonly exports: any
  }

  interface Module {}

  interface Table {
    readonly length: number
    get(index: number): any
    set(index: number, value: any): void
    grow(delta: number): number
  }

  interface Global {
    value: any
    valueOf(): any
  }

  interface MemoryDescriptor {
    initial: number
    maximum?: number
    shared?: boolean
  }

  interface TableDescriptor {
    element: 'anyfunc' | 'externref'
    initial: number
    maximum?: number
  }

  interface GlobalDescriptor {
    value: string
    mutable?: boolean
  }

  interface ImportObject {
    [key: string]: any
  }

  // Alias for import objects
  type Imports = ImportObject

  class Memory {
    constructor(descriptor: MemoryDescriptor)
    readonly buffer: ArrayBuffer
    grow(delta: number): number
  }

  class Module {
    constructor(bytes: BufferSource)
  }

  class Instance {
    constructor(module: Module, importObject?: ImportObject)
    readonly exports: any
  }

  class Table {
    constructor(descriptor: TableDescriptor)
    readonly length: number
    get(index: number): any
    set(index: number, value: any): void
    grow(delta: number): number
  }

  class Global {
    constructor(descriptor: GlobalDescriptor, value?: any)
    value: any
    valueOf(): any
  }

  function validate(bytes: BufferSource): boolean
  function compile(bytes: BufferSource): Promise<Module>
  
  // Two overloads for instantiate
  function instantiate(bytes: BufferSource, importObject?: ImportObject): Promise<{
    module: Module
    instance: Instance
  }>
  function instantiate(moduleObject: Module, importObject?: ImportObject): Promise<Instance>
}
