(function installWentianCaptureCore(globalScope) {
  if (globalScope.WentianCaptureCore) {
    return;
  }

  const SURFACES = Object.freeze({
    doubao_web: Object.freeze({
      surfaceCode: "doubao_web",
      productLabel: "豆包网页版",
      origin: "https://www.doubao.com",
    }),
    qianwen_web: Object.freeze({
      surfaceCode: "qianwen_web",
      productLabel: "千问网页版",
      origin: "https://www.qianwen.com",
    }),
    deepseek_web: Object.freeze({
      surfaceCode: "deepseek_web",
      productLabel: "DeepSeek 网页版",
      origin: "https://chat.deepseek.com",
    }),
  });
  const DRAFT_SCHEMA_VERSION = "wentian-consumer-capture@0-draft";

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t\u00a0]+/g, " ")
      .replace(/[ ]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeHttpUrl(value, baseUrl) {
    try {
      const url = new URL(value, baseUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return null;
      }
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }

  function selectReferenceUrlCandidate(rawValues, pageUrl) {
    const page = normalizeHttpUrl(pageUrl, pageUrl);
    if (!page) return null;
    const pageOrigin = new URL(page).origin;
    const candidates = [];
    const seen = new Set();
    for (const rawValue of rawValues ?? []) {
      const url = normalizeHttpUrl(rawValue, page);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const parsed = new URL(url);
      const isCurrentChat =
        parsed.origin === pageOrigin &&
        (parsed.pathname === "/chat" || parsed.pathname.startsWith("/chat/"));
      if (!isCurrentChat) candidates.push(url);
    }
    return (
      candidates.find((url) => new URL(url).origin !== pageOrigin) ??
      candidates[0] ??
      null
    );
  }

  function mergeReferenceLinkObservations(existing, observed) {
    const merged = [...(existing ?? [])];
    for (const candidate of observed ?? []) {
      if (
        merged.some(
          (item) =>
            item?.key === candidate?.key && item?.url === candidate?.url,
        )
      ) {
        continue;
      }
      merged.push(candidate);
    }
    return merged;
  }

  function normalizeVisibleCitations(rawLinks, baseUrl) {
    const seen = new Set();
    const citations = [];

    for (const rawLink of rawLinks ?? []) {
      if (rawLink?.visible === false) {
        continue;
      }
      const observedUrl = normalizeHttpUrl(rawLink?.url, baseUrl);
      if (!observedUrl) {
        continue;
      }
      const resolvedTargetUrl = resolveKnownRedirectTarget(observedUrl);
      const url = resolvedTargetUrl ?? observedUrl;
      if (seen.has(url)) {
        continue;
      }
      seen.add(url);
      const label = normalizeText(rawLink?.label) || new URL(url).hostname;
      const citation = {
        url,
        label: label.slice(0, 500),
        position: citations.length + 1,
      };
      if (resolvedTargetUrl) {
        citation.observed_url = observedUrl;
        citation.resolution = "known_redirect_target";
      }
      citations.push(citation);
    }

    return citations;
  }

  function resolveKnownRedirectTarget(observedUrl) {
    try {
      const url = new URL(observedUrl);
      if (url.hostname !== "link.wtturl.cn") {
        return null;
      }
      const target = url.searchParams.get("target");
      if (!/^https?:\/\//i.test(target ?? "")) {
        return null;
      }
      return normalizeHttpUrl(target, observedUrl);
    } catch {
      return null;
    }
  }

  function countSourceEvidenceSignals(value) {
    return (
      normalizeText(value).match(
        /参考来源\s*(?:[:：]|[（(]\s*\d{1,3}\s*[）)])?|信息来源汇总|信息来源\s*[:：]|参考\s*\d{1,3}\s*篇资料|\d{1,3}\s*篇来源/g,
      )?.length ?? 0
    );
  }

  function extractSourceMentionHints(answerText) {
    const lines = normalizeText(answerText)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const hints = [];
    const seen = new Set();
    let inSourceSummary = false;

    for (const line of lines) {
      const heading = line.replace(/^#{1,6}\s*/, "");
      if (heading === "信息来源汇总") {
        inSourceSummary = true;
        continue;
      }
      if (inSourceSummary && /^#{1,6}\s+/.test(line)) {
        inSourceSummary = false;
      }

      const inlineMatch = line.match(/参考来源[:：]\s*(.+)$/);
      if (inlineMatch) {
        for (const part of splitMentionList(inlineMatch[1])) {
          addHint(part, line);
        }
        continue;
      }

      if (inSourceSummary) {
        const numberedMatch = line.match(/^\d+[.、]\s*(.+)$/);
        const label = extractSourceSummaryLabel(
          numberedMatch ? numberedMatch[1] : line,
        );
        if (label) {
          addHint(label, line);
          continue;
        }
        inSourceSummary = false;
      }
    }

    return hints;

    function addHint(rawLabel, evidenceText) {
      const label = cleanMentionLabel(rawLabel);
      const dedupeKey = label.toLocaleLowerCase("zh-CN");
      if (!label || seen.has(dedupeKey)) {
        return;
      }
      seen.add(dedupeKey);
      hints.push({
        label,
        position: hints.length + 1,
        evidenceText: normalizeText(evidenceText).slice(0, 1_000),
        classification: "unverified_text_mention",
      });
    }
  }

  function splitMentionList(value) {
    return String(value ?? "")
      .split(/[、,，;；]/)
      .map(cleanMentionLabel)
      .filter(Boolean);
  }

  function cleanMentionLabel(value) {
    return normalizeText(value)
      .replace(/^[\-*•\s]+/, "")
      .replace(/[。；;，,：:\s]+$/, "")
      .slice(0, 500);
  }

  function extractSourceSummaryLabel(value) {
    const line = cleanMentionLabel(value);
    if (!line || /^(?:⚠️|以上|提示|注\s*[:：]|如果|免责声明)/.test(line)) {
      return null;
    }
    const colonMatch = line.match(/^([^:：]{1,80})[:：]\s*.+$/);
    if (colonMatch) {
      return cleanMentionLabel(colonMatch[1]);
    }
    const titleMatch = line.match(/^([^《\n]{1,80})《[^》]+》/);
    if (titleMatch) {
      return cleanMentionLabel(titleMatch[1]);
    }
    const domainMatch = line.match(/^((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\s|$)/i);
    return domainMatch ? cleanMentionLabel(domainMatch[1]) : null;
  }

  function createDraftCapturePayload(input) {
    if (!input?.userInitiated) {
      throw new Error("CAPTURE_NOT_USER_INITIATED");
    }
    const surface = getSurfaceForPageUrl(input.pageUrl);
    if (!surface) {
      throw new Error("CAPTURE_PAGE_NOT_ALLOWED");
    }
    if (input.pageOrigin !== surface.origin) {
      throw new Error("CAPTURE_ORIGIN_MISMATCH");
    }
    const pageUrl = normalizeHttpUrl(input.pageUrl, `${surface.origin}/`);
    if (!pageUrl || !isAllowedPageUrl(pageUrl)) {
      throw new Error("CAPTURE_PAGE_NOT_ALLOWED");
    }

    const answerText = normalizeText(input.answerText);
    if (!answerText) {
      throw new Error("CAPTURE_ANSWER_EMPTY");
    }
    if (
      !String(input.selectedRegionScreenshotDataUrl ?? "").startsWith(
        "data:image/png;base64,",
      )
    ) {
      throw new Error("CAPTURE_SCREENSHOT_REQUIRED");
    }

    return {
      schema_version: DRAFT_SCHEMA_VERSION,
      adapter_status: "draft",
      surface_code: surface.surfaceCode,
      collection_method: "browser_assisted",
      confirmation_status: "needs_review",
      answer_text: answerText,
      visible_citations: normalizeVisibleCitations(input.visibleLinks, pageUrl),
      visible_search_trace: normalizeVisibleSearchTrace(
        input.visibleSearchTrace,
      ),
      source_mention_hints: extractSourceMentionHints(answerText),
      visible_metadata: {
        product_label: surface.productLabel,
        page_title: normalizeText(input.pageTitle).slice(0, 500),
        page_origin: surface.origin,
        search_mode: "unknown",
        observed_at: input.observedAt,
      },
      screenshot: {
        scope: "selected_visible_region",
        media_type: "image/png",
        data_url: input.selectedRegionScreenshotDataUrl,
      },
    };
  }

  function normalizeVisibleSearchTrace(input) {
    if (!input || input.status === "not_present") {
      return {
        status: "not_present",
        summary_text: null,
        declared_keyword_count: null,
        keywords: [],
        declared_reference_count: null,
      };
    }
    const summaryText = normalizeText(input.summaryText).slice(0, 500);
    const declaredKeywordCount = Number(input.declaredKeywordCount);
    const declaredReferenceCount = Number(input.declaredReferenceCount);
    if (
      !summaryText ||
      !Number.isInteger(declaredKeywordCount) ||
      declaredKeywordCount < 1 ||
      declaredKeywordCount > 100 ||
      !Number.isInteger(declaredReferenceCount) ||
      declaredReferenceCount < 0 ||
      declaredReferenceCount > 100
    ) {
      throw new Error("CAPTURE_VISIBLE_SEARCH_TRACE_INVALID");
    }
    const keywords = [...(input.keywords ?? [])]
      .slice(0, 100)
      .map((keyword, index) => ({
        position: index + 1,
        text: normalizeText(keyword?.text ?? keyword).slice(0, 500),
      }))
      .filter((keyword) => keyword.text);
    const status =
      input.status === "complete" && keywords.length === declaredKeywordCount
        ? "complete"
        : "partial";
    return {
      status,
      summary_text: summaryText,
      declared_keyword_count: declaredKeywordCount,
      keywords,
      declared_reference_count: declaredReferenceCount,
    };
  }

  function getSurfaceForPageUrl(value) {
    try {
      const url = new URL(value);
      const surface = Object.values(SURFACES).find(
        (candidate) => candidate.origin === url.origin,
      );
      if (!surface || url.username || url.password) return null;
      const allowedPath = isAllowedSurfacePath(
        surface.surfaceCode,
        url.pathname,
      );
      return allowedPath ? surface : null;
    } catch {
      return null;
    }
  }

  function isAllowedSurfacePath(surfaceCode, pathname) {
    if (surfaceCode === "doubao_web") {
      return pathname === "/chat" || pathname.startsWith("/chat/");
    }
    if (surfaceCode === "qianwen_web") {
      return (
        pathname === "/" ||
        pathname.startsWith("/chat") ||
        pathname.startsWith("/conversation")
      );
    }
    return (
      surfaceCode === "deepseek_web" &&
      (pathname === "/" ||
        pathname === "/a/chat" ||
        pathname.startsWith("/a/chat/"))
    );
  }

  function isAllowedPageUrl(value) {
    return Boolean(getSurfaceForPageUrl(value));
  }

  globalScope.WentianCaptureCore = Object.freeze({
    SURFACES,
    DRAFT_SCHEMA_VERSION,
    createDraftCapturePayload,
    countSourceEvidenceSignals,
    extractSourceMentionHints,
    getSurfaceForPageUrl,
    isAllowedPageUrl,
    normalizeHttpUrl,
    normalizeText,
    normalizeVisibleSearchTrace,
    normalizeVisibleCitations,
    selectReferenceUrlCandidate,
    mergeReferenceLinkObservations,
  });
})(globalThis);
