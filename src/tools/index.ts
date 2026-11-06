import { registerAnalysisTools } from "./analysisTools";
import { registerCommandTools } from "./commandTools";
import { registerEditTools } from "./editTools";
import { registerFileTools } from "./fileTools";
import { registerRefactorTools } from "./refactorTools";
import { ToolCtx } from "./types";

export function registerTools(ctx: ToolCtx): number {
  registerFileTools(ctx);
  registerEditTools(ctx);
  registerAnalysisTools(ctx);
  registerRefactorTools(ctx);
  registerCommandTools(ctx);
  // Число зарегистрированных тулз знает сам server (tools/list); здесь —
  // приблизительная метрика для лога: сколько категорий включено.
  return Object.values(ctx.enabled).filter(Boolean).length;
}
