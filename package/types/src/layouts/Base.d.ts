export default Base;
declare class Base {
    constructor(renderer: any);
    renderer: any;
    mindMap: any;
    draw: any;
    lineDraw: any;
    root: any;
    lru: Lru;
    rootNodeCenterOffset: {
        x: number;
        y: number;
    };
    doLayout(): void;
    renderLine(): void;
    renderExpandBtn(): void;
    renderGeneralization(): void;
    cacheNode(uid: any, node: any): void;
    checkIsNeedResizeSources(): boolean;
    checkIsLayerTypeChange(oldIndex: any, newIndex: any): boolean;
    checkIsLayoutChangeRerenderExpandBtnPlaceholderRect(node: any): void;
    getNumberInfo({ parent, ancestors, layerIndex, index }: {
        parent: any;
        ancestors: any;
        layerIndex: any;
        index: any;
    }): {
        hasNumberPlugin: boolean;
        newNumberStr: any;
    };
    checkIsNodeDataChange(lastData: any, curData: any): boolean;
    createNode(data: any, parent: any, isRoot: any, layerIndex: any, index: any, ancestors: any): any;
    checkGetGeneralizationChange(node: any, isResizeSource: any): void;
    formatPosition(value: any, size: any, nodeSize: any): number;
    formatInitRootNodePosition(pos: any): any;
    setNodeCenter(node: any, position: any): void;
    getRootCenterOffset(width: any, height: any): {
        x: number;
        y: number;
    };
    updateChildren(children: any, prop: any, offset: any): void;
    updateChildrenPro(children: any, props: any): void;
    getNodeAreaWidth(node: any, withGeneralization?: boolean): number;
    quadraticCurvePath(x1: any, y1: any, x2: any, y2: any, v?: boolean): string;
    cubicBezierPath(x1: any, y1: any, x2: any, y2: any, v?: boolean): string;
    computeNewPoint(a: any, b: any, radius?: number): any[];
    createFoldLine(list: any): string;
    getMarginX(layerIndex: any): any;
    getMarginY(layerIndex: any): any;
    getNodeWidthWithGeneralization(node: any): number;
    getNodeHeightWithGeneralization(node: any): number;
    /**
     * dir：生长方向，h（水平）、v（垂直）
     * isLeft：是否向左生长
     */
    getNodeBoundaries(node: any, dir: any): {
        left: any;
        right: any;
        top: any;
        bottom: any;
        generalizationLineMargin: any;
        generalizationNodeMargin: any;
    };
    getChildrenBoundaries(node: any, dir: any, startIndex: number, endIndex: any): {
        left: number;
        right: number;
        top: number;
        bottom: number;
        generalizationLineMargin: any;
        generalizationNodeMargin: any;
    };
    getNodeGeneralizationRenderBoundaries(item: any, dir: any): {
        left: any;
        right: any;
        top: any;
        bottom: any;
        generalizationLineMargin: any;
        generalizationNodeMargin: any;
    };
    getNodeActChildrenLength(node: any): any;
    setLineStyle(style: any, line: any, path: any, childNode: any): void;
    transformPath(path: any): any;
}
import Lru from "../utils/Lru";
