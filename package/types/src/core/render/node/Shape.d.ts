export default class Shape {
    constructor(node: any);
    node: any;
    mindMap: any;
    getShapePadding(width: any, height: any, paddingX: any, paddingY: any): {
        paddingX: number;
        paddingY: number;
    };
    createShape(): any;
    getNodeSize(): {
        width: any;
        height: any;
    };
    createPath(pathStr: any): any;
    createPolygon(points: any): any;
    createRect(): any;
    createDiamond(): any;
    createParallelogram(): any;
    createRoundedRectangle(): any;
    createOctagonalRectangle(): any;
    createOuterTriangularRectangle(): any;
    createInnerTriangularRectangle(): any;
    createEllipse(): any;
    createCircle(): any;
}
export const shapeList: string[];
