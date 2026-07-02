declare module "@motion/engine" {
  export default function init(input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<void>;

  export class MotionEngine {
    constructor();
    loadDocument(documentJson: string): void;
    loadBrandPackage(packageJson: string): void;
    setViewport(width: number, height: number, scale: number): void;
    render(timestamp: number): string;
    pointerDown(x: number, y: number, modifiers: number): void;
    pointerMove(x: number, y: number): void;
    pointerUp(x: number, y: number): void;
    applyCommand(commandJson: string): void;
    undo(): boolean;
    redo(): boolean;
    nextStep(): boolean;
    previousStep(): boolean;
    jumpToScene(sceneId: string): boolean;
    restartScene(): void;
    getPosition(): string;
    getSelection(): string;
    inspect(): string;
    runPreflight(): string;
    serializeDocument(): string;
    listScenes(): string;
  }
}
