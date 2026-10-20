import { redirect } from "react-router"

/** The home page and unknown paths both lead to the campaigns. */
export const loader = () => redirect("/campaigns")
