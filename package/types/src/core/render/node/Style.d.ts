export default Style;
declare class Style {
    static setBackgroundStyle(el: any, themeConfig: any): void;
    static removeBackgroundStyle(el: any): void;
    constructor(ctx: any);
    ctx: any;
    _markerPath: any;
    _marker: any;
    _gradient: any;
    merge(prop: any, root: any): string;
    getStyle(prop: any, root: any): string;
    getSelfStyle(prop: any): any;
    addToEffectiveStyles(styles: any): void;
    rect(node: any): void;
    shape(node: any): void;
    text(node: any): void;
    createStyleText(): string;
    getTextFontStyle(): {
        italic: boolean;
        bold: string;
        fontSize: string;
        fontFamily: string;
    };
    domText(node: any, fontSizeScale: number, isMultiLine: any): void;
    tagText(node: any, style: any): void;
    tagRect(node: any, style: any): void;
    iconNode(node: any): void;
    line(line: any, { width, color, dasharray }: {
        width: any;
        color: any;
        dasharray: any;
    }, enableMarker: any, childNode: any): void;
    createMarker(): any;
    generalizationLine(node: any): void;
    iconBtn(node: any, node2: any, fillNode: any): void;
    hasCustomStyle(): boolean;
    hoverNode(node: any): void;
    onRemove(): void;
}
declare namespace Style {
    const cacheStyle: any;
}
