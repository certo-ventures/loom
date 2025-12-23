/**
 * Document Processing Pipeline with Wait Gates and Parallel Execution
 * 
 * Architecture:
 * - Event-driven actor orchestration
 * - Dynamic fan-out (N files → N×M pages)
 * - Barrier synchronization (wait gates)
 * - Type-based grouping and consolidation
 */

import { EventEmitter } from 'events'

// ============================================================================
// Pipeline State Types
// ============================================================================

export interface FileSetState {
  fileSetId: string
  uploadedAt: Date
  files: FileState[]
  status: 'uploaded' | 'processing' | 'classified' | 'extracted' | 'consolidated' | 'complete' | 'failed'
}

export interface FileState {
  fileId: string
  fileSetId: string
  fileName: string
  status: 'pending' | 'processing' | 'split' | 'complete' | 'failed'
  pages: PageState[]
  totalPages?: number
}

export interface PageState {
  pageId: string
  fileId: string
  pageNumber: number
  pngPath: string
  status: 'created' | 'classifying' | 'classified' | 'extracting' | 'extracted' | 'consolidated'
  documentType?: string
  extractedData?: any
  classification?: {
    type: string
    confidence: number
  }
}

export interface DocumentTypeGroup {
  fileSetId: string
  documentType: string
  pages: PageState[]
  expectedPages: number  // May not know upfront
  status: 'collecting' | 'ready' | 'consolidating' | 'complete'
  consolidatedSchema?: any
}

// ============================================================================
// Pipeline Events
// ============================================================================

export interface PipelineEvent {
  type: string
  timestamp: Date
  fileSetId: string
}

export interface FileSetUploadedEvent extends PipelineEvent {
  type: 'FileSetUploaded'
  files: { fileId: string; fileName: string; path: string }[]
}

export interface FileProcessedEvent extends PipelineEvent {
  type: 'FileProcessed'
  fileId: string
  totalPages: number
}

export interface PageCreatedEvent extends PipelineEvent {
  type: 'PageCreated'
  pageId: string
  fileId: string
  pageNumber: number
  pngPath: string
}

export interface PageClassifiedEvent extends PipelineEvent {
  type: 'PageClassified'
  pageId: string
  documentType: string
  confidence: number
}

export interface PageExtractedEvent extends PipelineEvent {
  type: 'PageExtracted'
  pageId: string
  documentType: string
  extractedData: any
}

export interface DocumentConsolidatedEvent extends PipelineEvent {
  type: 'DocumentConsolidated'
  documentType: string
  consolidatedSchema: any
  pageCount: number
}

// ============================================================================
// Wait Gate Implementation
// ============================================================================

/**
 * Generic Wait Gate for barrier synchronization
 * Tracks completion of N items before triggering next stage
 */
export class WaitGate<T = any> {
  private expectedCount: number | 'dynamic' = 'dynamic'
  private completed: Set<string> = new Set()
  private data: Map<string, T> = new Map()
  private triggerCallback?: (items: T[]) => void | Promise<void>

  constructor(
    private name: string,
    expectedCount?: number
  ) {
    if (expectedCount !== undefined) {
      this.expectedCount = expectedCount
    }
  }

  /**
   * Set expected count (for dynamic fan-out where we learn the count later)
   */
  setExpectedCount(count: number): void {
    this.expectedCount = count
    this.checkCompletion()
  }

  /**
   * Mark an item as complete
   */
  complete(itemId: string, data?: T): void {
    this.completed.add(itemId)
    if (data) {
      this.data.set(itemId, data)
    }
    this.checkCompletion()
  }

  /**
   * Register callback to trigger when gate opens
   */
  onComplete(callback: (items: T[]) => void | Promise<void>): void {
    this.triggerCallback = callback
    this.checkCompletion()
  }

  /**
   * Check if gate should open
   */
  private async checkCompletion(): Promise<void> {
    if (this.expectedCount === 'dynamic') {
      return // Don't trigger until we know expected count
    }

    if (this.completed.size >= this.expectedCount) {
      console.log(`✅ Wait gate "${this.name}" opened: ${this.completed.size}/${this.expectedCount}`)
      
      if (this.triggerCallback) {
        const items = Array.from(this.data.values())
        await this.triggerCallback(items)
      }
    }
  }

  getProgress(): { completed: number; expected: number | 'dynamic'; percentage: number | null } {
    return {
      completed: this.completed.size,
      expected: this.expectedCount,
      percentage: this.expectedCount === 'dynamic' 
        ? null 
        : (this.completed.size / this.expectedCount) * 100
    }
  }

  reset(): void {
    this.completed.clear()
    this.data.clear()
  }
}

// ============================================================================
// Pipeline Coordinator (State Machine)
// ============================================================================

export class DocumentPipelineCoordinator extends EventEmitter {
  private fileSetStates: Map<string, FileSetState> = new Map()
  private pageStates: Map<string, PageState> = new Map()
  private documentGroups: Map<string, DocumentTypeGroup> = new Map()
  
  // Wait gates for each stage
  private fileProcessingGates: Map<string, WaitGate<FileState>> = new Map()
  private consolidationGates: Map<string, WaitGate<PageState>> = new Map()

  constructor() {
    super()
    this.setupEventHandlers()
  }

  /**
   * Start processing a new FileSet
   */
  async processFileSet(event: FileSetUploadedEvent): Promise<void> {
    const { fileSetId, files } = event

    // Initialize state
    const fileSetState: FileSetState = {
      fileSetId,
      uploadedAt: new Date(),
      files: files.map(f => ({
        fileId: f.fileId,
        fileSetId,
        fileName: f.fileName,
        status: 'pending',
        pages: []
      })),
      status: 'processing'
    }

    this.fileSetStates.set(fileSetId, fileSetState)

    // Create wait gate for file processing stage
    const fileGate = new WaitGate<FileState>(`FileSet-${fileSetId}-Files`, files.length)
    this.fileProcessingGates.set(fileSetId, fileGate)

    // When all files processed → move to classification stage
    fileGate.onComplete(async (completedFiles) => {
      console.log(`🎯 All ${files.length} files processed for FileSet ${fileSetId}`)
      fileSetState.status = 'classified'
      this.emit('stage:classification:ready', { fileSetId })
    })

    // Emit events to spawn file processor actors
    for (const file of files) {
      this.emit('file:process', {
        fileSetId,
        fileId: file.fileId,
        fileName: file.fileName,
        path: file.path
      })
    }
  }

  /**
   * Handle file processing completion
   */
  handleFileProcessed(event: FileProcessedEvent): void {
    const { fileSetId, fileId, totalPages } = event
    const fileSetState = this.fileSetStates.get(fileSetId)!
    const fileState = fileSetState.files.find(f => f.fileId === fileId)!

    fileState.status = 'split'
    fileState.totalPages = totalPages

    // Mark file as complete in wait gate
    const gate = this.fileProcessingGates.get(fileSetId)!
    gate.complete(fileId, fileState)
  }

  /**
   * Handle page classification
   */
  handlePageClassified(event: PageClassifiedEvent): void {
    const { fileSetId, pageId, documentType, confidence } = event
    const pageState = this.pageStates.get(pageId)!

    pageState.status = 'classified'
    pageState.documentType = documentType
    pageState.classification = { type: documentType, confidence }

    // Add page to document type group
    const groupKey = `${fileSetId}:${documentType}`
    let group = this.documentGroups.get(groupKey)
    
    if (!group) {
      group = {
        fileSetId,
        documentType,
        pages: [],
        expectedPages: 0, // Don't know yet
        status: 'collecting'
      }
      this.documentGroups.set(groupKey, group)
    }

    group.pages.push(pageState)

    // Trigger extraction for this page
    this.emit('page:extract', { pageId, documentType })
  }

  /**
   * Handle page extraction completion
   */
  handlePageExtracted(event: PageExtractedEvent): void {
    const { fileSetId, pageId, documentType, extractedData } = event
    const pageState = this.pageStates.get(pageId)!

    pageState.status = 'extracted'
    pageState.extractedData = extractedData

    const groupKey = `${fileSetId}:${documentType}`
    const group = this.documentGroups.get(groupKey)!

    // Check if this document type group is complete
    this.checkDocumentTypeCompletion(fileSetId, documentType)
  }

  /**
   * Check if all pages of a document type are extracted
   * This is a WAIT GATE based on "all files processed AND all pages of type classified"
   */
  private checkDocumentTypeCompletion(fileSetId: string, documentType: string): void {
    const fileSetState = this.fileSetStates.get(fileSetId)!
    const groupKey = `${fileSetId}:${documentType}`
    const group = this.documentGroups.get(groupKey)!

    // Are all files in the FileSet processed?
    const allFilesProcessed = fileSetState.files.every(f => f.status === 'split')
    if (!allFilesProcessed) {
      return // Still waiting for files to be split
    }

    // Count total pages of this type
    const totalPagesOfType = Array.from(this.pageStates.values())
      .filter(p => {
        const file = fileSetState.files.find(f => f.fileId === p.fileId)
        return file && p.documentType === documentType
      })
      .length

    // Count extracted pages of this type
    const extractedPages = group.pages.filter(p => p.status === 'extracted').length

    if (extractedPages === totalPagesOfType && totalPagesOfType > 0) {
      console.log(`🎯 WAIT GATE: All ${totalPagesOfType} pages of "${documentType}" extracted!`)
      group.status = 'ready'

      // Trigger consolidation
      this.emit('document:consolidate', {
        fileSetId,
        documentType,
        pages: group.pages
      })
    }
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.on('fileset:uploaded', (e: FileSetUploadedEvent) => this.processFileSet(e))
    this.on('file:processed', (e: FileProcessedEvent) => this.handleFileProcessed(e))
    this.on('page:classified', (e: PageClassifiedEvent) => this.handlePageClassified(e))
    this.on('page:extracted', (e: PageExtractedEvent) => this.handlePageExtracted(e))
  }

  /**
   * Get pipeline status
   */
  getStatus(fileSetId: string) {
    const fileSetState = this.fileSetStates.get(fileSetId)
    const groups = Array.from(this.documentGroups.entries())
      .filter(([key]) => key.startsWith(fileSetId))
      .map(([_, group]) => group)

    return {
      fileSet: fileSetState,
      documentGroups: groups,
      fileProcessingGate: this.fileProcessingGates.get(fileSetId)?.getProgress()
    }
  }
}
