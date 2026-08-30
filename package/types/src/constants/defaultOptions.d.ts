export namespace defaultOpt {
    const el: any;
    const data: any;
    const viewData: any;
    const readonly: boolean;
    const layout: string;
    const fishboneDeg: number;
    const theme: string;
    const themeConfig: {};
    const scaleRatio: number;
    const translateRatio: number;
    const minZoomRatio: number;
    const maxZoomRatio: number;
    const customCheckIsTouchPad: any;
    const mouseScaleCenterUseMousePosition: boolean;
    const maxTag: number;
    const tagPosition: string;
    const expandBtnSize: number;
    const imgTextMargin: number;
    const textContentMargin: number;
    const customNoteContentShow: any;
    const textAutoWrapWidth: number;
    const customHandleMousewheel: any;
    const mousewheelAction: string;
    const mousewheelMoveStep: number;
    const mousewheelZoomActionReverse: boolean;
    const defaultInsertSecondLevelNodeText: string;
    const defaultInsertBelowSecondLevelNodeText: string;
    namespace expandBtnStyle {
        const color: string;
        const fill: string;
        const fontSize: number;
        const strokeColor: string;
    }
    namespace expandBtnIcon {
        const open: string;
        const close: string;
    }
    const expandBtnNumHandler: any;
    const isShowExpandNum: boolean;
    const enableShortcutOnlyWhenMouseInSvg: boolean;
    const initRootNodePosition: any;
    const nodeTextEditZIndex: number;
    const nodeNoteTooltipZIndex: number;
    const isEndNodeTextEditOnClickOuter: boolean;
    const maxHistoryCount: number;
    const alwaysShowExpandBtn: boolean;
    const notShowExpandBtn: boolean;
    const iconList: any[];
    const maxNodeCacheCount: number;
    const fitPadding: number;
    const enableCtrlKeyNodeSelection: boolean;
    const useLeftKeySelectionRightKeyDrag: boolean;
    const beforeTextEdit: any;
    const isUseCustomNodeContent: boolean;
    const customCreateNodeContent: any;
    const customInnerElsAppendTo: any;
    const enableAutoEnterTextEditWhenKeydown: boolean;
    const customHandleClipboardText: any;
    const disableMouseWheelZoom: boolean;
    function errorHandler(code: any, error: any): void;
    const enableDblclickBackToRootNode: boolean;
    const hoverRectColor: string;
    const hoverRectPadding: number;
    const selectTextOnEnterEditText: boolean;
    const deleteNodeActive: boolean;
    const fit: boolean;
    const tagsColorMap: {};
    namespace cooperateStyle {
        export const avatarSize: number;
        const fontSize_1: number;
        export { fontSize_1 as fontSize };
    }
    const onlyOneEnableActiveNodeOnCooperate: boolean;
    const defaultGeneralizationText: string;
    const handleIsSplitByWrapOnPasteCreateNewNode: any;
    const addHistoryTime: number;
    const isDisableDrag: boolean;
    const createNewNodeBehavior: string;
    const defaultNodeImage: string;
    const isLimitMindMapInCanvas: boolean;
    const handleNodePasteImg: any;
    const customCreateNodePath: any;
    const customCreateNodePolygon: any;
    const customTransformNodeLinePath: any;
    const beforeShortcutRun: any;
    const resetScaleOnMoveNodeToCenter: boolean;
    const createNodePrefixContent: any;
    const createNodePostfixContent: any;
    const disabledClipboard: boolean;
    const customHyperlinkJump: any;
    const openPerformance: boolean;
    namespace performanceConfig {
        const time: number;
        const padding: number;
        const removeNodeWhenOutCanvas: boolean;
    }
    const emptyTextMeasureHeightText: string;
    const openRealtimeRenderOnNodeTextEdit: boolean;
    const mousedownEventPreventDefault: boolean;
    const onlyPasteTextWhenHasImgAndText: boolean;
    const enableDragModifyNodeWidth: boolean;
    const minNodeTextModifyWidth: number;
    const maxNodeTextModifyWidth: number;
    const selectTranslateStep: number;
    const selectTranslateLimit: number;
    const enableFreeDrag: boolean;
    const autoMoveWhenMouseInEdgeOnDrag: boolean;
    namespace dragMultiNodeRectConfig {
        export const width: number;
        export const height: number;
        const fill_1: string;
        export { fill_1 as fill };
    }
    const dragPlaceholderRectFill: string;
    namespace dragPlaceholderLineConfig {
        const color_1: string;
        export { color_1 as color };
        const width_1: number;
        export { width_1 as width };
    }
    namespace dragOpacityConfig {
        const cloneNodeOpacity: number;
        const beingDragNodeOpacity: number;
    }
    const handleDragCloneNode: any;
    const beforeDragEnd: any;
    const beforeDragStart: any;
    namespace watermarkConfig {
        const onlyExport: boolean;
        const text: string;
        const lineSpacing: number;
        const textSpacing: number;
        const angle: number;
        namespace textStyle {
            const color_2: string;
            export { color_2 as color };
            export const opacity: number;
            const fontSize_2: number;
            export { fontSize_2 as fontSize };
        }
        const belowNode: boolean;
    }
    const exportPaddingX: number;
    const exportPaddingY: number;
    const resetCss: string;
    const minExportImgCanvasScale: number;
    const addContentToHeader: any;
    const addContentToFooter: any;
    const handleBeingExportSvg: any;
    const maxCanvasSize: number;
    const defaultAssociativeLineText: string;
    const associativeLineIsAlwaysAboveNode: boolean;
    namespace associativeLineInitPointsPosition {
        const from: string;
        const to: string;
    }
    const enableAdjustAssociativeLinePoints: boolean;
    const beforeAssociativeLineConnection: any;
    const disableTouchZoom: boolean;
    const minTouchZoomScale: number;
    const maxTouchZoomScale: number;
    const isLimitMindMapInCanvasWhenHasScrollbar: boolean;
    const isOnlySearchCurrentRenderNodes: boolean;
    const beforeCooperateUpdate: any;
    namespace rainbowLinesConfig {
        const open_1: boolean;
        export { open_1 as open };
        export const colorsList: any[];
    }
    const demonstrateConfig: any;
    const enableEditFormulaInRichTextEdit: boolean;
    const katexFontPath: string;
    const getKatexOutputType: any;
    const transformRichTextOnEnterEdit: any;
    const beforeHideRichTextEdit: any;
    const richTextEditFakeInPlace: boolean;
    const outerFramePaddingX: number;
    const outerFramePaddingY: number;
    const onlyPainterNodeCustomStyles: boolean;
    const beforeDeleteNodeImg: any;
    const imgResizeBtnSize: number;
    const minImgResizeWidth: number;
    const minImgResizeHeight: number;
    const maxImgResizeWidthInheritTheme: boolean;
    const maxImgResizeWidth: number;
    const maxImgResizeHeight: number;
}
