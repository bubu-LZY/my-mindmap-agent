/**
 * 防御 XSS 攻击，过滤恶意 HTML 标签和属性
 * @param {string} text 需要过滤的文本
 * @returns {string} 过滤后的文本
 */
export function defenseXSS(text: string): string;
