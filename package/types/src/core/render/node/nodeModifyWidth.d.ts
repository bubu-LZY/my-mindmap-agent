declare namespace _default {
    export { initDragHandle };
    export { onDragMousemoveHandle };
    export { onDragMouseupHandle };
    export { createDragHandleNode };
    export { updateDragHandle };
}
export default _default;
declare function initDragHandle(): void;
declare class initDragHandle {
    _dragHandleNodes: any;
    dragHandleWidth: number;
    dragHandleMousedownX: number;
    isDragHandleMousedown: boolean;
    dragHandleIndex: number;
    dragHandleMousedownCustomTextWidth: number;
    dragHandleMousedownBodyCursor: string;
    dragHandleMousedownLeft: number;
    onDragMousemoveHandle: any;
    onDragMouseupHandle: any;
}
declare function onDragMousemoveHandle(e: any): void;
declare class onDragMousemoveHandle {
    constructor(e: any);
    customTextWidth: any;
    left: any;
}
declare function onDragMouseupHandle(): void;
declare class onDragMouseupHandle {
    isDragHandleMousedown: boolean;
    dragHandleMousedownX: number;
    dragHandleIndex: number;
    dragHandleMousedownCustomTextWidth: number;
}
declare function createDragHandleNode(): any[];
declare class createDragHandleNode {
    dragHandleMousedownX: any;
    dragHandleIndex: number;
    dragHandleMousedownCustomTextWidth: any;
    dragHandleMousedownBodyCursor: string;
    dragHandleMousedownLeft: any;
    isDragHandleMousedown: boolean;
}
declare function updateDragHandle(): void;
declare class updateDragHandle {
    _dragHandleNodes: any;
}
