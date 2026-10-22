// Wrangler bundles .txt imports as strings.
declare module "*.txt" {
  const text: string
  export default text
}
