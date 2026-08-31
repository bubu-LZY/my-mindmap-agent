export function walk(root: any, parent: any, beforeCallback: any, afterCallback: any, isRoot: any, layerIndex?: number, index?: number, ancestors?: any[]): void;
export function bfsWalk(root: any, callback: any): void;
export function resizeImgSizeByOriginRatio(width: any, height: any, newWidth: any, newHeight: any): any[];
export function resizeImgSize(width: any, height: any, maxWidth: any, maxHeight: any): any[];
export function resizeImg(imgUrl: any, maxWidth: any, maxHeight: any): Promise<any>;
export function getStrWithBrFromHtml(str: any): any;
export function simpleDeepClone(data: any): any;
export function copyRenderTree(tree: any, root: any, removeActiveState?: boolean): any;
export function copyNodeTree(tree: any, root: any, removeActiveState?: boolean, removeId?: boolean): any;
export function imgToDataUrl(src: any, returnBlob?: boolean): Promise<any>;
export function parseDataUrl(data: any): any;
export function downloadFile(file: any, fileName: any): void;
export function throttle(fn: any, time: number, ctx: any): (...args: any[]) => void;
export function asyncRun(taskList: any, callback?: () => void): void;
export function degToRad(deg: any): number;
export function camelCaseToHyphen(str: any): any;
export function measureText(text: any, { italic, bold, fontSize, fontFamily }: {
    italic: any;
    bold: any;
    fontSize: any;
    fontFamily: any;
}): {
    width: any;
    height: any;
};
export function joinFontStr({ italic, bold, fontSize, fontFamily }: {
    italic: any;
    bold: any;
    fontSize: any;
    fontFamily: any;
}): string;
export function nextTick(fn: any, ctx: any): () => void;
export function checkNodeOuter(mindMap: any, node: any): {
    isOuter: boolean;
    offsetLeft: number;
    offsetTop: number;
};
export function getTextFromHtml(html: any): any;
export function readBlob(blob: any): Promise<any>;
export function nodeToHTML(node: any): any;
export function getImageSize(src: any): Promise<any>;
export function createUid(): any;
export function loadImage(imgFile: any): Promise<any>;
export function removeHTMLEntities(str: any): any;
export function getType(data: any): any;
export function isUndef(data: any): boolean;
export function removeHtmlStyle(html: any): any;
export function addHtmlStyle(html: any, tag: any, style: any): any;
export function checkIsRichText(str: any): boolean;
export function replaceHtmlText(html: any, searchText: any, replaceText: any): any;
export function removeHtmlNodeByClass(html: any, selector: any): any;
export function isWhite(color: any): boolean;
export function isTransparent(color: any): boolean;
export function getVisibleColorFromTheme(themeConfig: any): any;
export function removeFormulaTags(node: any): void;
export function nodeRichTextToTextWithWrap(html: any): string;
export function textToNodeRichTextWithWrap(html: any): string;
export function removeRichTextStyes(html: any): any;
export function isMobile(): boolean;
export function getObjectChangedProps(oldObject: any, newObject: any): {};
export function checkIsNodeStyleDataKey(key: any): boolean;
export function mergerIconList(list: any): any;
export function getTopAncestorsFomNodeList(list: any): any[];
export function checkHasSupSubRelation(list: any): boolean;
export function parseAddGeneralizationNodeList(list: any): any[];
export function checkTwoRectIsOverlap(minx1: any, maxx1: any, miny1: any, maxy1: any, minx2: any, maxx2: any, miny2: any, maxy2: any): boolean;
export function focusInput(el: any): void;
export function selectAllInput(el: any): void;
export function addDataToAppointNodes(appointNodes: any, data?: {}): any;
export function createUidForAppointNodes(appointNodes: any, createNewId?: boolean, handle?: any): any;
export function formatDataToArray(data: any): any[];
export function getNodeDataIndex(node: any): any;
export function getNodeIndexInNodeList(node: any, nodeList: any): any;
export function generateColorByContent(str: any): string;
export function htmlEscape(str: any): any;
export function isSameObject(a: any, b: any): boolean;
export function setDataToClipboard(data: any): void;
export function getDataFromClipboard(): Promise<{
    text: any;
    img: any;
}>;
export function removeFromParentNodeData(node: any): void;
export function handleSelfCloseTags(str: any): any;
export function checkNodeListIsEqual(list1: any, list2: any): boolean;
export function getChromeVersion(): number | "";
export function createSmmFormatData(data: any): {
    simpleMindMap: boolean;
    data: any;
};
export function checkSmmFormatData(data: any): {
    isSmm: boolean;
    data: any;
};
export function handleInputPasteText(e: any, text: any): void;
export function transformTreeDataToObject(data: any): {};
export function transformObjectToTreeData(data: any): {
    data: any;
    children: any[];
};
export function getTwoPointDistance(x1: any, y1: any, x2: any, y2: any): number;
export function getRectRelativePosition(rect1: any, rect2: any): "left" | "right" | "top" | "bottom" | "left-top" | "right-top" | "right-bottom" | "left-bottom" | "overlap";
export function handleGetSvgDataExtraContent({ addContentToHeader, addContentToFooter }: {
    addContentToHeader: any;
    addContentToFooter: any;
}): {
    cssTextList: any[];
    header: any;
    headerHeight: number;
    footer: any;
    footerHeight: number;
};
export function getNodeTreeBoundingRect(node: any, x?: number, y?: number, paddingX?: number, paddingY?: number, excludeSelf?: boolean, excludeGeneralization?: boolean): {
    left: number;
    top: number;
    width: number;
    height: number;
};
export function getNodeListBoundingRect(nodeList: any, x?: number, y?: number, paddingX?: number, paddingY?: number): {
    left: number;
    top: number;
    width: number;
    height: number;
};
export const fullscrrenEvent: "fullscreenchange" | "webkitfullscreenchange" | "mozfullscreenchange" | "msfullscreenchange";
export function fullScreen(element: any): void;
export function exitFullScreen(): void;
export function createForeignObjectNode({ el, width, height }: {
    el: any;
    width: any;
    height: any;
}): any;
export function formatGetNodeGeneralization(data: any): any[];
export function defenseXSS(text: string): string;
export function addXmlns(el: any): void;
export function sortNodeList(nodeList: any): any;
export function mergeTheme(dest: any, source: any): any;
