export async function execute(args, context) {
  const name = String(args.name || '朋友')
  return {
    success: true,
    message: `你好，${name}！`,
    data: { name }
  }
}
