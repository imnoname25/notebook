ALTER TABLE "ApplicationSettings" ADD COLUMN "liveWidgetAllowedCidrs" TEXT NOT NULL DEFAULT '';

CREATE TABLE "LiveWidgetIndex" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "blockId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "refreshMode" TEXT NOT NULL,
  "displaySize" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveWidgetIndex_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveWidgetResult" (
  "widgetId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "detail" TEXT,
  "latencyMs" INTEGER,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "resultData" JSONB,
  CONSTRAINT "LiveWidgetResult_pkey" PRIMARY KEY ("widgetId")
);

CREATE UNIQUE INDEX "LiveWidgetIndex_pageId_blockId_key" ON "LiveWidgetIndex"("pageId", "blockId");
CREATE INDEX "LiveWidgetIndex_pageId_idx" ON "LiveWidgetIndex"("pageId");
CREATE INDEX "LiveWidgetIndex_type_idx" ON "LiveWidgetIndex"("type");
CREATE INDEX "LiveWidgetResult_status_checkedAt_idx" ON "LiveWidgetResult"("status", "checkedAt");
ALTER TABLE "LiveWidgetIndex" ADD CONSTRAINT "LiveWidgetIndex_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveWidgetResult" ADD CONSTRAINT "LiveWidgetResult_widgetId_fkey" FOREIGN KEY ("widgetId") REFERENCES "LiveWidgetIndex"("id") ON DELETE CASCADE ON UPDATE CASCADE;
