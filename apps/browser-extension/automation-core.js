(function installWentianAutomationCore(globalScope) {
  if (globalScope.WentianAutomationCore) {
    return;
  }

  const PAGE_SIGNATURE_VERSIONS = Object.freeze({
    doubao_web: "doubao-web-signature@6-visible-reference-panel",
    qianwen_web: "qianwen-web-signature@2-visible-reference-panel",
    deepseek_web: "deepseek-web-signature@1-visible-page",
  });
  const MIN_ANSWER_LENGTH = 80;
  const STABLE_ANSWER_MS = 5_000;

  function selectComposer(candidates) {
    return (
      [...(candidates ?? [])]
        .filter(
          (candidate) =>
            candidate?.visible === true &&
            candidate.disabled !== true &&
            (candidate.kind === "textarea" ||
              candidate.kind === "contenteditable"),
        )
        .map((candidate) => ({
          candidate,
          score:
            (candidate.kind === "textarea" ? 40 : 30) +
            (candidate.role === "textbox" ? 20 : 0) +
            (/(?:发送|提问|输入|消息|ask|message)/i.test(
              String(candidate.label ?? ""),
            )
              ? 20
              : 0) +
            Math.max(
              0,
              Math.min(20, Number(candidate.viewportBottomScore) || 0),
            ),
        }))
        .sort((left, right) => right.score - left.score)[0]?.candidate ?? null
    );
  }

  function selectNewAnswer(candidates, baselineKeys) {
    const baseline = new Set(baselineKeys ?? []);
    return (
      [...(candidates ?? [])]
        .filter((candidate) => {
          const text = normalizeText(candidate?.text);
          return (
            candidate?.visible === true &&
            candidate.insideComposer !== true &&
            text.length >= MIN_ANSWER_LENGTH &&
            text.length <= 200_000 &&
            !baseline.has(candidate.key)
          );
        })
        .map((candidate) => {
          const text = normalizeText(candidate.text);
          return {
            candidate,
            score:
              (Number(candidate.viewportTop) || 0) +
              Math.min(text.length, 5_000) / 100 +
              (Number(candidate.depth) || 0) * 2,
          };
        })
        .sort((left, right) => right.score - left.score)[0]?.candidate ?? null
    );
  }

  function selectSubmitControl(candidates) {
    const blockedControlPattern =
      /(?:停止|stop|语音|voice|麦克风|microphone|附件|attach|上传|upload|图片|image|搜索|search|模型|model)/i;
    const sendControlPattern = /(?:发送|send|提交|submit)/i;
    return (
      [...(candidates ?? [])]
        .filter((candidate) => {
          const signal = `${String(candidate?.label ?? "")} ${String(
            candidate?.identifier ?? "",
          )}`;
          const recognized =
            candidate?.submitType === true ||
            sendControlPattern.test(signal) ||
            (candidate?.iconOnly === true &&
              candidate?.nearComposer === true &&
              candidate?.onComposerRight === true);
          return (
            candidate?.visible === true &&
            candidate.disabled !== true &&
            !blockedControlPattern.test(signal) &&
            recognized
          );
        })
        .map((candidate) => {
          const signal = `${String(candidate.label ?? "")} ${String(
            candidate.identifier ?? "",
          )}`;
          return {
            candidate,
            score:
              (candidate.submitType === true ? 120 : 0) +
              (sendControlPattern.test(signal) ? 100 : 0) +
              (candidate.sameForm === true ? 40 : 0) +
              (candidate.onComposerRight === true ? 20 : 0) +
              Math.max(0, Math.min(20, Number(candidate.proximityScore) || 0)),
          };
        })
        .sort((left, right) => right.score - left.score)[0]?.candidate ?? null
    );
  }

  function isStableCompleteAnswer(input) {
    const text = normalizeText(input?.answerText);
    return (
      input?.pageSignatureMatched === true &&
      input?.visible === true &&
      input?.hasVisibleStopControl === false &&
      text.length >= MIN_ANSWER_LENGTH &&
      Number.isFinite(input?.stableForMs) &&
      input.stableForMs >= STABLE_ANSWER_MS
    );
  }

  function isBlankComposerText(value, surfaceCode) {
    const text = normalizeText(value)
      .replace(/\uFEFF/g, "")
      .trim();
    if (!text) return true;
    if (surfaceCode === "qianwen_web") return text === "向千问提问";
    return (
      surfaceCode === "deepseek_web" &&
      /^(?:给\s*DeepSeek\s*发送消息|向\s*DeepSeek\s*提问|Message\s+DeepSeek)$/i.test(
        text,
      )
    );
  }

  function isNewConversationLabel(value) {
    const label = normalizeText(value);
    return /^(?:(?:新对话|新建对话|创建对话|开启对话|发起对话)(?:\s.*)?|new\s+(?:chat|conversation))$/i.test(
      label,
    );
  }

  function parseReferencePanelLabel(value) {
    const label = normalizeText(value);
    if (!label || label.length > 200) {
      return null;
    }
    const match =
      label.match(
        /(?:搜索\s*\d+\s*个关键词[，,\s]*)?参考\s*(\d{1,3})\s*篇资料/,
      ) ??
      label.match(/(\d{1,3})\s*篇来源/) ??
      label.match(/参考来源\s*[（(]\s*(\d{1,3})\s*[）)]/);
    if (!match) {
      return null;
    }
    const count = Number(match[1]);
    return Number.isInteger(count) && count >= 1 && count <= 100 ? count : null;
  }

  function selectReferencePanelTrigger(candidates) {
    return (
      [...(candidates ?? [])]
        .map((candidate) => ({
          candidate,
          expectedCount: parseReferencePanelLabel(candidate?.label),
        }))
        .filter(
          ({ candidate, expectedCount }) =>
            expectedCount !== null &&
            candidate?.visible === true &&
            (candidate.nearAnswer === true || candidate.insideAnswer === true),
        )
        .map(({ candidate, expectedCount }) => ({
          candidate,
          expectedCount,
          score:
            (candidate.insideAnswer === true ? 200 : 0) +
            (candidate.nearAnswer === true ? 100 : 0) -
            Math.min(Math.max(Number(candidate.distance) || 0, 0), 2_000) / 10 -
            Math.min(Math.max(Number(candidate.area) || 0, 0), 2_000_000) /
              100_000,
        }))
        .sort((left, right) => right.score - left.score)
        .map(({ candidate, expectedCount }) => ({
          ...candidate,
          expectedCount,
        }))[0] ?? null
    );
  }

  function selectReferencePanelLinkChange(input) {
    const expectedCount = Number(input?.expectedCount);
    if (
      !Number.isInteger(expectedCount) ||
      expectedCount < 1 ||
      expectedCount > 100
    ) {
      return null;
    }
    const before = [...(input?.before ?? [])].filter(
      (candidate) => candidate?.visible === true,
    );
    const after = [...(input?.after ?? [])].filter(
      (candidate) => candidate?.visible === true,
    );
    const beforeKeys = new Set(before.map((candidate) => candidate.key));
    const afterKeys = new Set(after.map((candidate) => candidate.key));
    const opened = after.filter((candidate) => !beforeKeys.has(candidate.key));
    const closed = before.filter((candidate) => !afterKeys.has(candidate.key));
    if (opened.length >= expectedCount) {
      return Object.freeze({
        status: "complete",
        direction: "opened",
        links: Object.freeze(opened.slice(0, expectedCount)),
      });
    }
    if (closed.length >= expectedCount) {
      return Object.freeze({
        status: "complete",
        direction: "closed",
        links: Object.freeze(closed.slice(0, expectedCount)),
      });
    }
    const partial = opened.length >= closed.length ? opened : closed;
    return Object.freeze({
      status: "incomplete",
      direction: opened.length >= closed.length ? "opened" : "closed",
      links: Object.freeze(partial),
    });
  }

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t\u00a0]+/g, " ")
      .replace(/[ ]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  globalScope.WentianAutomationCore = Object.freeze({
    MIN_ANSWER_LENGTH,
    PAGE_SIGNATURE_VERSION: PAGE_SIGNATURE_VERSIONS.doubao_web,
    PAGE_SIGNATURE_VERSIONS,
    pageSignatureVersion(surfaceCode) {
      return PAGE_SIGNATURE_VERSIONS[surfaceCode] ?? null;
    },
    STABLE_ANSWER_MS,
    isStableCompleteAnswer,
    isBlankComposerText,
    isNewConversationLabel,
    normalizeText,
    parseReferencePanelLabel,
    selectComposer,
    selectNewAnswer,
    selectReferencePanelLinkChange,
    selectReferencePanelTrigger,
    selectSubmitControl,
  });
})(globalThis);
