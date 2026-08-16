import { z } from "zod";

export const HttpUrlSchema = z.url("url must be a valid URL").refine((url) => {
  const scheme = new URL(url).protocol;
  return scheme === "http:" || scheme === "https:";
}, "url must use http or https");
