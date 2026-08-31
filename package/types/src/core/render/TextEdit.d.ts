export default class TextEdit {
    constructor(renderer: any);
    renderer: any;
    mindMap: any;
    currentNode: any;
    textEditNode: HTMLDivElement;
    showTextEdit: boolean;
    cacheEditingText: string;
    hasBodyMousedown: boolean;
    textNodePaddingX: number;
    textNodePaddingY: number;
    bindEvent(): void;
    show({ node, isInserting, isFromKeyDown, isFromScale }: {
        node: any;
        isInserting?: boolean;
        isFromKeyDown?: boolean;
        isFromScale?: boolean;
    }): Promise<void>;
    onScale(): void;
    onKeydown(e: any): void;
    unBindEvent(): void;
    checkIsAutoEnterTextEditKey(e: any): boolean;
    registerTmpShortcut(): void;
    isShowTextEdit(): any;
    showEditTextBox({ node, rect, isInserting, isFromKeyDown, isFromScale }: {
        node: any;
        rect: any;
        isInserting: any;
        isFromKeyDown: any;
        isFromScale: any;
    }): void;
    updateTextEditNode(): void;
    removeTextEditEl(): void;
    getEditText(): any;
    hideEditTextBox(): any;
    getCurrentEditNode(): any;
}
