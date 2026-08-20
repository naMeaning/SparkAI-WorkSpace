import { parseListLimit, parsePositiveInteger } from "../http.js";
import type { ListPageOptions } from "../types.js";

export function parsePageOptions(url: URL, defaultPageSize = 20): Required<ListPageOptions> {
  return {
    page: parsePositiveInteger(url.searchParams.get("page") || url.searchParams.get("p") || 1, "page"),
    pageSize: parseListLimit(url.searchParams.get("pageSize") || url.searchParams.get("page_size"), defaultPageSize, 100)
  };
}
