export default LogicalStructure;
declare class LogicalStructure extends Base {
    constructor(opt: {}, layout: any);
    isUseLeft: boolean;
    computedBaseValue(): void;
    computedTopValue(): void;
    adjustTopValue(): void;
    updateBrothers(node: any, addHeight: any): void;
    renderLineStraight(node: any, lines: any, style: any): any[];
    renderLineDirect(node: any, lines: any, style: any): any[];
    renderLineCurve(node: any, lines: any, style: any): any[];
    renderExpandBtnRect(rect: any, expandBtnSize: any, width: any, height: any): void;
}
import Base from "./Base";
