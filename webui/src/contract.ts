export interface NoteDocument { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: NoteDocument[]; }
export interface NoteBridge { conflict: boolean; hasResearch(id: string): boolean; hasSavedResearch(id: string): boolean; append(id: string, document: NoteDocument): Promise<void>; }
export interface WorkspaceSplitLayout { active: boolean; noteWidth: number; historyOpen: boolean; enter(): void; restore(): void; resize(width: number): void; setHistoryOpen(open: boolean): void; }
