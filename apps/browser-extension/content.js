(function installWentianCaptureUi(globalScope) {
  if (globalScope.__wentianCaptureInstalled) {
    return;
  }
  globalScope.__wentianCaptureInstalled = true;

  const core = globalScope.WentianCaptureCore;
  const automationCore = globalScope.WentianAutomationCore;
  const activeSurface = () => core.getSurfaceForPageUrl(location.href);
  const productName = () =>
    activeSurface()?.surfaceCode === "qianwen_web" ? "千问" : "豆包";
  const state = {
    active: false,
    candidate: null,
    originalOutline: "",
    originalOutlineOffset: "",
    host: null,
    shadow: null,
    payload: null,
    automationRunId: 0,
    batchActive: false,
    batchHandoffCode: "",
    batchTotal: 0,
    batchCompleted: 0,
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "WT_OPEN_PANEL") {
      openModePanel();
    } else if (message?.type === "WT_BEGIN_SELECTION") {
      beginSelection();
    }
  });

  function openModePanel() {
    if (!activeSurface()) {
      return;
    }
    clearCaptureUi();
    document.addEventListener("keydown", handleKeyDown, true);
    renderModePanel();
  }

  function beginSelection() {
    if (!activeSurface()) {
      return;
    }
    clearCaptureUi();
    state.active = true;
    renderInstruction();
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleSelectionClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
  }

  function handleMouseMove(event) {
    if (!state.active || !(event.target instanceof Element)) {
      return;
    }
    const candidate = findCaptureCandidate(event.target);
    if (candidate && candidate !== state.candidate) {
      highlightCandidate(candidate);
    }
  }

  function handleSelectionClick(event) {
    if (!state.active || !(event.target instanceof Element)) {
      return;
    }
    if (state.host?.contains(event.target)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const candidate = state.candidate ?? findCaptureCandidate(event.target);
    stopSelectionListeners();
    if (!candidate) {
      renderError("未识别到有效回答区域，请重新选择。");
      return;
    }
    void captureSelectedCandidate(candidate);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (state.batchActive) {
        stopAutomationBatch();
      } else {
        clearCaptureUi();
      }
    }
  }

  function renderModePanel() {
    const shadow = ensureUi();
    shadow.replaceChildren(createStyles());
    const panel = document.createElement("section");
    panel.className = "wt-panel wt-small";
    const title = document.createElement("h2");
    title.textContent = "问天采集";
    const detail = document.createElement("p");
    detail.textContent =
      "自动提问会先由本机问天检查项目开关、任务和上线授权；未通过时不会操作当前页面。";
    const handoffLabel = document.createElement("label");
    handoffLabel.textContent = "问天单题或整批接入码";
    const handoff = document.createElement("textarea");
    handoff.className = "wt-handoff";
    handoff.placeholder = "从问天任务页复制单题或整批接入码后粘贴";
    handoff.autocomplete = "off";
    handoff.spellcheck = false;
    const status = document.createElement("p");
    status.className = "wt-status";
    status.textContent = "尚未开始。";
    const automatic = document.createElement("button");
    automatic.className = "wt-button primary";
    automatic.textContent = "自动采集单题";
    automatic.addEventListener("click", async () => {
      automatic.disabled = true;
      status.textContent = "正在向本机问天检查自动化门禁……";
      try {
        const response = await chrome.runtime.sendMessage({
          type: "WT_AUTOMATION_PREFLIGHT",
          handoffCode: handoff.value,
        });
        if (!response?.ok) {
          automatic.disabled = false;
          status.textContent = response?.error ?? "自动化预检未通过。";
          return;
        }
        if (
          !automationCore ||
          response.result.page_signature_version !==
            automationCore.pageSignatureVersion(response.result.surface_code)
        ) {
          automatic.disabled = false;
          status.textContent = `${productName()}页面驱动版本不匹配，请重新加载扩展或改用手动选择。`;
          return;
        }
        const handoffCode = handoff.value.trim();
        handoff.value = "";
        await runVisiblePageAutomation(response.result, handoffCode);
      } catch {
        automatic.disabled = false;
        status.textContent = "无法完成自动化预检，请改用手动选择。";
      }
    });
    const batch = document.createElement("button");
    batch.className = "wt-button primary";
    batch.textContent = "连续采集整批";
    batch.addEventListener("click", () => {
      const batchHandoffCode = handoff.value.trim();
      if (!batchHandoffCode) {
        status.textContent = "请先粘贴问天生成的整批接入码。";
        return;
      }
      state.batchActive = true;
      state.batchHandoffCode = batchHandoffCode;
      state.batchTotal = 0;
      state.batchCompleted = 0;
      handoff.value = "";
      void runAutomationBatch();
    });
    const manual = document.createElement("button");
    manual.className = "wt-button secondary";
    manual.textContent = "手动选择当前回答";
    manual.addEventListener("click", beginSelection);
    const close = document.createElement("button");
    close.className = "wt-button secondary";
    close.textContent = "关闭";
    close.addEventListener("click", clearCaptureUi);
    const actions = document.createElement("div");
    actions.className = "wt-actions";
    actions.append(batch, automatic, manual, close);
    panel.append(title, detail, handoffLabel, handoff, status, actions);
    shadow.append(panel);
  }

  async function runAutomationBatch() {
    if (!state.batchActive || !state.batchHandoffCode) {
      return;
    }
    const requestId = state.automationRunId + 1;
    state.automationRunId = requestId;
    renderAutomationProgress("正在从问天领取下一项任务……");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "WT_BATCH_NEXT",
        batchHandoffCode: state.batchHandoffCode,
      });
      if (!state.batchActive || state.automationRunId !== requestId) {
        return;
      }
      if (!response?.ok) {
        renderBatchFailure(response?.error ?? "领取下一项任务失败。");
        return;
      }
      if (response.result.status === "complete") {
        state.batchTotal = response.result.total_task_count;
        state.batchCompleted = response.result.completed_task_count;
        renderBatchComplete();
        return;
      }
      if (
        !automationCore ||
        response.result.preflight.page_signature_version !==
          automationCore.pageSignatureVersion(
            response.result.preflight.surface_code,
          )
      ) {
        renderBatchFailure(
          `${productName()}页面驱动版本不匹配，请重新加载扩展后继续。`,
        );
        return;
      }
      state.batchTotal = response.result.total_task_count;
      state.batchCompleted = response.result.completed_task_count;
      await ensureNewConversation(
        response.result.session_conditions.is_new_conversation,
        requestId,
      );
      if (!state.batchActive || state.automationRunId !== requestId) {
        return;
      }
      await runVisiblePageAutomation(
        response.result.preflight,
        response.result.handoff_code,
        {
          totalTaskCount: response.result.total_task_count,
          completedTaskCount: response.result.completed_task_count,
          queryText: response.result.task.query_text,
          sampleIndex: response.result.task.sample_index,
        },
      );
    } catch (error) {
      if (!state.batchActive || state.automationRunId !== requestId) {
        return;
      }
      renderBatchFailure(
        error instanceof Error &&
          error.message === "AUTOMATION_NEW_CONVERSATION_CONTROL_NOT_FOUND"
          ? `当前任务要求使用新对话，但未能打开${productName()}的“新对话”入口。请确认页面已完整加载后重试。`
          : `整批任务未能继续，请确认问天和${productName()}页面均正常。`,
      );
    }
  }

  async function ensureNewConversation(required, runId) {
    if (!required || (isBlankChatPath() && !hasExistingConversation())) {
      return;
    }
    let control = findNewConversationControl();
    if (!control) {
      const sidebarToggle = findSidebarToggleControl();
      if (sidebarToggle) {
        sidebarToggle.click();
        const menuDeadline = Date.now() + 2_000;
        while (Date.now() < menuDeadline && !control) {
          if (state.automationRunId !== runId) {
            return;
          }
          await delay(100);
          control = findNewConversationControl();
        }
      }
    }
    if (!control) {
      throw new Error("AUTOMATION_NEW_CONVERSATION_CONTROL_NOT_FOUND");
    }
    const previousUrl = location.href;
    control.click();
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (state.automationRunId !== runId) {
        return;
      }
      const composer = findComposerElement();
      const composerText = composer
        ? automationCore.normalizeText(
            "value" in composer ? composer.value : composer.textContent,
          )
        : "";
      if (
        composer &&
        automationCore.isBlankComposerText(
          composerText,
          activeSurface()?.surfaceCode,
        ) &&
        (location.href !== previousUrl || isBlankChatPath())
      ) {
        await delay(500);
        return;
      }
      await delay(200);
    }
    throw new Error("AUTOMATION_NEW_CONVERSATION_CONTROL_NOT_FOUND");
  }

  function hasExistingConversation() {
    return [
      ...document.querySelectorAll(
        '[data-message-id], [data-testid*="message"], article, [class*="message"], [class*="answer"]',
      ),
    ].some(
      (element) =>
        isRendered(element) &&
        automationCore.normalizeText(element.innerText).length >= 80,
    );
  }

  function isBlankChatPath(pathname = location.pathname) {
    return activeSurface()?.surfaceCode === "qianwen_web"
      ? pathname === "/" || pathname === "/chat" || pathname === "/chat/"
      : pathname === "/chat" || pathname === "/chat/";
  }

  function isChatPath() {
    return core.isAllowedPageUrl(location.href);
  }

  function findNewConversationControl() {
    const candidates = [
      ...document.querySelectorAll(
        'button, [role="button"], a, [tabindex], li, div, span',
      ),
    ].flatMap((element) => {
      if (!isRendered(element)) return [];
      const label = automationCore.normalizeText(
        element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.innerText,
      );
      const testId = element.getAttribute("data-testid") ?? "";
      const href = element.getAttribute("href");
      const opensBlankChat = (() => {
        if (!href) return false;
        try {
          return isBlankChatPath(new URL(href, location.href).pathname);
        } catch {
          return false;
        }
      })();
      if (
        !automationCore.isNewConversationLabel(label) &&
        !/(?:new|create).*(?:chat|conversation)/i.test(testId) &&
        !opensBlankChat
      ) {
        return [];
      }
      const target =
        element.closest(
          'button, a, [role="button"], [tabindex]:not([tabindex="-1"]), li',
        ) ?? element;
      if (!isRendered(target)) return [];
      const rect = target.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        ? [{ element: target, area: rect.width * rect.height }]
        : [];
    });
    candidates.sort((left, right) => left.area - right.area);
    return candidates[0]?.element ?? null;
  }

  function findSidebarToggleControl() {
    const candidates = [
      ...document.querySelectorAll(
        'button, [role="button"], [tabindex], [aria-label], [title], [data-testid], div, span',
      ),
    ].flatMap((element) => {
      if (!isRendered(element)) return [];
      const rect = element.getBoundingClientRect();
      const label = automationCore.normalizeText(
        [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("data-testid"),
          element.innerText,
        ]
          .filter(Boolean)
          .join(" "),
      );
      if (/新对话|新工作任务/.test(label)) return [];
      const namedToggle =
        /sidebar|side-bar|drawer|navigation|menu|侧边栏|导航|菜单|展开/i.test(
          label,
        );
      const topLeftToggle =
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.left + rect.width / 2 < 72 &&
        rect.top + rect.height / 2 < 120 &&
        rect.width <= 80 &&
        rect.height <= 80;
      if (!namedToggle && !topLeftToggle) return [];
      return [
        {
          element,
          score: (namedToggle ? 100 : 0) + (topLeftToggle ? 200 : 0),
        },
      ];
    });
    candidates.sort((left, right) => right.score - left.score);
    return candidates[0]?.element ?? null;
  }

  async function runVisiblePageAutomation(
    preflight,
    handoffCode,
    batchContext = null,
  ) {
    const runId = state.automationRunId + 1;
    state.automationRunId = runId;
    renderAutomationProgress(`正在识别当前${productName()}输入框……`);
    const composer = findComposerElement();
    if (!composer) {
      renderAutomationFailure("未识别到可用输入框，页面结构可能已变化。");
      return;
    }
    const baselineKeys = collectAnswerCandidates(composer).map(
      (item) => item.key,
    );
    try {
      await setComposerText(composer, preflight.prompt);
      renderAutomationProgress("已填入当前任务问题，正在发送……");
      await submitComposer(composer, baselineKeys);
      renderAutomationProgress(
        "问题已发送，正在等待回答完成。最长等待3分钟，可按 Esc 取消。",
      );
      const answer = await waitForStableAnswer(composer, baselineKeys, runId);
      if (state.automationRunId !== runId) {
        return;
      }
      renderAutomationProgress(
        `回答已完成，正在读取${productName()}可见信源……`,
      );
      const preparedCapture = await prepareCaptureCandidate(answer, runId);
      if (state.automationRunId !== runId) {
        return;
      }
      await captureCandidate(
        answer,
        handoffCode,
        batchContext,
        preparedCapture,
      );
    } catch (error) {
      if (state.automationRunId !== runId) {
        return;
      }
      const message = isReferencePanelCaptureError(error)
        ? `${productName()}显示了参考资料，但未能读取完整的可见链接。本题没有提交，请确认参考资料面板可正常展开后重试。`
        : error instanceof Error && error.message === "AUTOMATION_TIMEOUT"
          ? "等待回答完成超时，本次未采集。"
          : error instanceof Error &&
              error.message === "AUTOMATION_SUBMIT_FAILED"
            ? "问题已经填入，但未能触发发送。请重新加载扩展后重试，或改用手动选择。"
            : "自动提问未完成，页面结构可能已变化。";
      if (batchContext && state.batchActive) {
        renderBatchFailure(message);
      } else {
        renderAutomationFailure(message);
      }
    }
  }

  function findCaptureCandidate(start) {
    let current = start;
    let bestCandidate = null;
    let bestSignalCount = -1;
    for (let depth = 0; depth < 8 && current; depth += 1) {
      if (current === document.body || current === document.documentElement) {
        break;
      }
      if (state.host?.contains(current)) {
        return null;
      }
      const text = core.normalizeText(current.innerText);
      const rect = current.getBoundingClientRect();
      if (
        text.length >= 80 &&
        text.length <= 200_000 &&
        rect.width >= 240 &&
        rect.height >= 48
      ) {
        const signalCount = core.countSourceEvidenceSignals(text);
        if (!bestCandidate || signalCount > bestSignalCount) {
          bestCandidate = current;
          bestSignalCount = signalCount;
        }
      }
      current = current.parentElement;
    }
    return bestCandidate;
  }

  function findComposerElement() {
    const viewportHeight = Math.max(window.innerHeight, 1);
    const candidates = [
      ...document.querySelectorAll(
        'textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]',
      ),
    ].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        element,
        kind:
          element instanceof HTMLTextAreaElement
            ? "textarea"
            : "contenteditable",
        role: element.getAttribute("role"),
        label: [
          element.getAttribute("aria-label"),
          element.getAttribute("placeholder"),
          element.getAttribute("data-placeholder"),
        ]
          .filter(Boolean)
          .join(" "),
        visible: isRendered(element) && rect.width >= 160 && rect.height >= 24,
        disabled:
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true",
        viewportBottomScore: Math.round(
          Math.max(0, Math.min(1, rect.bottom / viewportHeight)) * 20,
        ),
      };
    });
    return automationCore.selectComposer(candidates)?.element ?? null;
  }

  async function setComposerText(composer, prompt) {
    composer.focus();
    if (composer instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      if (!setter) {
        throw new Error("AUTOMATION_COMPOSER_UNSUPPORTED");
      }
      setter.call(composer, prompt);
      composer.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertText",
          data: prompt,
        }),
      );
      composer.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      selectComposerContents(composer);
      if (dispatchPlainTextPaste(composer, prompt)) {
        await delay(50);
      }
      if (readComposerText(composer) !== automationCore.normalizeText(prompt)) {
        selectComposerContents(composer);
        const inserted =
          typeof document.execCommand === "function" &&
          document.execCommand("insertText", false, prompt);
        if (inserted) {
          await delay(50);
        }
      }
      if (readComposerText(composer) !== automationCore.normalizeText(prompt)) {
        composer.textContent = prompt;
        composer.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: "insertText",
            data: prompt,
          }),
        );
      }
    }
    await delay(50);
    const actual = automationCore.normalizeText(
      composer instanceof HTMLTextAreaElement
        ? composer.value
        : composer.innerText || composer.textContent,
    );
    if (actual !== automationCore.normalizeText(prompt)) {
      throw new Error("AUTOMATION_COMPOSER_VALUE_MISMATCH");
    }
  }

  function selectComposerContents(composer) {
    const selection = globalScope.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function dispatchPlainTextPaste(composer, prompt) {
    try {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", prompt);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData,
      });
      composer.dispatchEvent(event);
      return event.defaultPrevented;
    } catch {
      return false;
    }
  }

  async function submitComposer(composer, baselineKeys) {
    const sendButton = await waitForSubmitControl(composer, 2_000);
    if (sendButton) {
      sendButton.focus();
      sendButton.click();
      if (await waitForSubmissionEffect(composer, baselineKeys, 3_000)) {
        return;
      }
    }
    const form = composer.closest("form");
    if (
      form instanceof HTMLFormElement &&
      typeof form.requestSubmit === "function"
    ) {
      try {
        form.requestSubmit();
        if (await waitForSubmissionEffect(composer, baselineKeys, 2_000)) {
          return;
        }
      } catch {
        // Continue to the explicit failure below.
      }
    }
    throw new Error("AUTOMATION_SUBMIT_FAILED");
  }

  async function waitForSubmitControl(composer, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const selected = findSubmitControl(composer);
      if (selected) {
        return selected;
      }
      await delay(100);
    }
    return null;
  }

  function findSubmitControl(composer) {
    const composerRect = composer.getBoundingClientRect();
    const form = composer.closest("form");
    const nearbyContainer = findNearbyComposerContainer(composer);
    const buttonCandidates = [
      ...document.querySelectorAll(
        '[data-testid="chat_input_send_button"], [data-testid*="send" i], [data-test-id*="send" i], [data-e2e*="send" i]',
      ),
      ...(form?.querySelectorAll('button, [role="button"]') ?? []),
      ...(nearbyContainer?.querySelectorAll('button, [role="button"]') ?? []),
      ...document.querySelectorAll('button, [role="button"]'),
    ];
    const seen = new Set();
    const candidates = buttonCandidates.flatMap((button) => {
      if (seen.has(button) || !(button instanceof HTMLElement)) {
        return [];
      }
      seen.add(button);
      const rect = button.getBoundingClientRect();
      const label = automationCore.normalizeText(
        button.getAttribute("aria-label") ||
          button.getAttribute("title") ||
          button.innerText ||
          button.querySelector("svg title")?.textContent,
      );
      const identifier = automationCore.normalizeText(
        [
          button.id,
          button.getAttribute("name"),
          button.getAttribute("data-testid"),
          button.getAttribute("data-test-id"),
          button.getAttribute("data-e2e"),
          button.getAttribute("data-id"),
        ]
          .filter(Boolean)
          .join(" "),
      );
      const verticalDistance = Math.abs(
        rect.top +
          rect.height / 2 -
          (composerRect.top + composerRect.height / 2),
      );
      const horizontalDistance = Math.abs(rect.left - composerRect.right);
      const nearComposer =
        verticalDistance < Math.max(120, composerRect.height * 1.5) &&
        horizontalDistance < 360;
      return [
        {
          element: button,
          label,
          identifier,
          visible: isRendered(button),
          disabled:
            button.getAttribute("aria-disabled") === "true" ||
            (button instanceof HTMLButtonElement && button.disabled),
          submitType:
            button instanceof HTMLButtonElement && button.type === "submit",
          sameForm: Boolean(form?.contains(button)),
          nearComposer,
          onComposerRight:
            rect.left + rect.width / 2 >=
            composerRect.left + composerRect.width * 0.55,
          iconOnly:
            !label &&
            Boolean(button.querySelector("svg, img")) &&
            rect.width >= 20 &&
            rect.width <= 96 &&
            rect.height >= 20 &&
            rect.height <= 96,
          proximityScore: Math.max(
            0,
            20 - Math.round((verticalDistance + horizontalDistance) / 20),
          ),
        },
      ];
    });
    return automationCore.selectSubmitControl(candidates)?.element ?? null;
  }

  function findNearbyComposerContainer(composer) {
    let current = composer.parentElement;
    for (let depth = 0; current && depth < 5; depth += 1) {
      if (current.querySelector('button, [role="button"]')) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  async function waitForSubmissionEffect(composer, baselineKeys, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (
        !composer.isConnected ||
        !readComposerText(composer) ||
        hasVisibleStopControl() ||
        automationCore.selectNewAnswer(
          collectAnswerCandidates(composer),
          baselineKeys,
        )
      ) {
        return true;
      }
      await delay(100);
    }
    return false;
  }

  function readComposerText(composer) {
    return automationCore.normalizeText(
      composer instanceof HTMLTextAreaElement
        ? composer.value
        : composer.innerText || composer.textContent,
    );
  }

  function collectAnswerCandidates(composer) {
    const nodes = new Set(
      document.querySelectorAll(
        '[data-testid*="message"], [data-message-id], article, [class*="message"], [class*="answer"]',
      ),
    );
    if (nodes.size < 2) {
      const main = document.querySelector("main") ?? document.body;
      for (const element of [...main.querySelectorAll("div")].slice(-1_500)) {
        nodes.add(element);
      }
    }
    return [...nodes].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        element,
        key: element,
        text: element.innerText,
        visible: isRendered(element) && rect.width >= 240 && rect.height >= 48,
        insideComposer:
          element === composer ||
          element.contains(composer) ||
          composer.contains(element) ||
          Boolean(state.host?.contains(element)),
        viewportTop: rect.top,
        depth: elementDepth(element),
      };
    });
  }

  function elementDepth(element) {
    let depth = 0;
    let current = element;
    while (current.parentElement && depth < 50) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  }

  async function waitForStableAnswer(composer, baselineKeys, runId) {
    const startedAt = Date.now();
    let lastText = "";
    let unchangedSince = startedAt;
    while (Date.now() - startedAt < 180_000) {
      if (state.automationRunId !== runId) {
        throw new Error("AUTOMATION_CANCELLED");
      }
      const selected = automationCore.selectNewAnswer(
        collectAnswerCandidates(composer),
        baselineKeys,
      );
      const text = automationCore.normalizeText(selected?.text);
      if (text !== lastText) {
        lastText = text;
        unchangedSince = Date.now();
      }
      if (
        selected &&
        automationCore.isStableCompleteAnswer({
          answerText: text,
          visible: isRendered(selected.element),
          hasVisibleStopControl: hasVisibleStopControl(),
          stableForMs: Date.now() - unchangedSince,
          pageSignatureMatched:
            Boolean(activeSurface()) &&
            isChatPath() &&
            Boolean(findComposerElement()),
        })
      ) {
        return selected.element;
      }
      await delay(1_000);
    }
    throw new Error("AUTOMATION_TIMEOUT");
  }

  function hasVisibleStopControl() {
    return [...document.querySelectorAll('button, [role="button"]')].some(
      (button) => {
        const label = automationCore.normalizeText(
          button.getAttribute("aria-label") ||
            button.getAttribute("title") ||
            button.innerText,
        );
        return (
          isRendered(button) &&
          /(?:停止生成|停止回答|stop generating)/i.test(label)
        );
      },
    );
  }

  async function captureSelectedCandidate(candidate) {
    const runId = state.automationRunId;
    renderCaptureProgress(`正在读取回答及${productName()}可见信源……`);
    try {
      const preparedCapture = await prepareCaptureCandidate(candidate, runId);
      if (state.automationRunId !== runId) {
        return;
      }
      await captureCandidate(candidate, "", null, preparedCapture);
    } catch (error) {
      if (state.automationRunId !== runId) {
        return;
      }
      renderError(
        isReferencePanelCaptureError(error)
          ? `${productName()}显示了参考资料，但未能读取完整的可见链接。请确认参考资料面板可正常展开后重新选择。`
          : "当前回答采集失败，请重新选择。",
      );
    }
  }

  async function prepareCaptureCandidate(candidate, runId) {
    const answerText = core.normalizeText(candidate.innerText);
    if (!answerText) {
      throw new Error("CAPTURE_ANSWER_EMPTY");
    }
    const additionalVisibleLinks = await collectReferencePanelLinks(
      candidate,
      runId,
    );
    return { answerText, additionalVisibleLinks };
  }

  async function collectReferencePanelLinks(answer, runId) {
    const trigger = findReferencePanelTrigger(answer);
    if (!trigger) {
      return [];
    }
    const before = collectRenderedReferenceLinks();
    trigger.element.click();
    const deadline = Date.now() + 5_000;
    let change = null;
    while (Date.now() < deadline) {
      if (state.automationRunId !== runId) {
        throw new Error("AUTOMATION_CANCELLED");
      }
      change = automationCore.selectReferencePanelLinkChange({
        before,
        after: collectRenderedReferenceLinks(),
        expectedCount: trigger.expectedCount,
      });
      if (change?.status === "complete") {
        break;
      }
      await delay(100);
    }
    if (change?.status !== "complete") {
      if (activeSurface()?.surfaceCode === "qianwen_web") {
        const cards = findQianwenReferenceCards(trigger.expectedCount);
        let links;
        try {
          links = await resolveQianwenReferenceCards(
            trigger.expectedCount,
            runId,
          );
        } catch {
          if (cards.length > 0) {
            await collapseReferencePanel(answer, trigger, cards, runId).catch(
              () => undefined,
            );
          }
          throw new Error(
            `AUTOMATION_REFERENCE_PANEL_TAB_RESOLUTION_FAILED:${trigger.expectedCount}`,
          );
        }
        await collapseReferencePanel(answer, trigger, cards, runId).catch(
          () => undefined,
        );
        return links;
      }
      if (change?.direction === "opened") {
        await collapseReferencePanel(
          answer,
          trigger,
          change?.links ?? [],
          runId,
        );
      }
      throw new Error(
        `AUTOMATION_REFERENCE_PANEL_INCOMPLETE:${trigger.expectedCount}:${change?.links.length ?? 0}`,
      );
    }
    if (change.direction === "opened") {
      await collapseReferencePanel(answer, trigger, change.links, runId);
    }
    return change.links.map((link) => ({
      url: link.url,
      label: link.label,
      visible: true,
    }));
  }

  async function resolveQianwenReferenceCards(expectedCount, runId) {
    const links = [];
    for (let index = 1; index <= expectedCount; index += 1) {
      if (state.automationRunId !== runId) {
        throw new Error("AUTOMATION_CANCELLED");
      }
      const card = findQianwenReferenceCards(expectedCount).find(
        (candidate) => candidate.index === index,
      );
      if (!card) {
        throw new Error("AUTOMATION_REFERENCE_PANEL_CARD_NOT_FOUND");
      }
      renderAutomationProgress(
        `正在读取千问可见来源 ${index} / ${expectedCount}……`,
      );
      const embeddedUrl = readQianwenReferenceCardUrl(card.element);
      if (embeddedUrl) {
        links.push({
          url: embeddedUrl,
          label: card.label,
          visible: true,
        });
        continue;
      }
      const watch = await chrome.runtime.sendMessage({
        type: "WT_SOURCE_TAB_WATCH_BEGIN",
      });
      if (!watch?.ok || !watch.result?.watch_id) {
        throw new Error("AUTOMATION_REFERENCE_PANEL_TAB_WATCH_FAILED");
      }
      card.element.scrollIntoView({ block: "center", inline: "nearest" });
      await delay(100);
      card.element.click();
      const result = await chrome.runtime.sendMessage({
        type: "WT_SOURCE_TAB_WATCH_RESULT",
        watchId: watch.result.watch_id,
      });
      if (!result?.ok || !core.normalizeHttpUrl(result.result?.url)) {
        throw new Error("AUTOMATION_REFERENCE_PANEL_TAB_OPEN_FAILED");
      }
      links.push({
        url: result.result.url,
        label: card.label,
        visible: true,
      });
      await delay(150);
    }
    return links;
  }

  function readQianwenReferenceCardUrl(element) {
    const metadata = readQianwenReferenceCardMetadata(element);
    if (!metadata) {
      return null;
    }
    for (const value of [metadata.url, metadata.ref_url]) {
      const url = core.normalizeHttpUrl(value, location.href);
      if (url && new URL(url).origin !== location.origin) {
        return url;
      }
    }
    return null;
  }

  function readQianwenReferenceCardMetadata(element) {
    const attributeNames = [
      "data-click-extra",
      "data-exposure-extra",
      "data-log-params",
    ];
    for (const attributeName of attributeNames) {
      const rawValue = element.getAttribute(attributeName);
      if (!rawValue) {
        continue;
      }
      try {
        const metadata = JSON.parse(rawValue);
        if (metadata && typeof metadata === "object") {
          return metadata;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  function findQianwenReferenceCards(expectedCount) {
    const headings = [
      ...document.querySelectorAll("div, span, p, h1, h2, h3, h4"),
    ].filter(
      (element) =>
        isRendered(element) &&
        automationCore.normalizeText(element.innerText) ===
          `参考来源 (${expectedCount})`,
    );
    for (const heading of headings) {
      let root = heading.parentElement;
      for (let depth = 0; root && depth < 8; depth += 1) {
        const cards = collectIndexedReferenceCards(root, expectedCount);
        if (cards.length >= expectedCount) {
          return cards.slice(0, expectedCount);
        }
        root = root.parentElement;
      }
    }
    return [];
  }

  function collectIndexedReferenceCards(root, expectedCount) {
    const cardsByIndex = new Map();
    const candidates = root.querySelectorAll(
      'div, li, article, button, [role="button"], [tabindex]',
    );
    for (const element of candidates) {
      if (!isRendered(element) || state.host?.contains(element)) {
        continue;
      }
      const label = automationCore.normalizeText(element.innerText);
      const textMatch = label.match(/^(\d{1,3})(?:\s+|[.、])/);
      const metadata = readQianwenReferenceCardMetadata(element);
      const metadataIndex = readQianwenReferenceCardIndex(metadata);
      if (
        (!textMatch && metadataIndex === null) ||
        !/(?:[a-z0-9-]+\.)+[a-z]{2,63}\b/i.test(label)
      ) {
        continue;
      }
      const index = metadataIndex ?? Number(textMatch[1]);
      if (!Number.isInteger(index) || index < 1 || index > expectedCount) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      const area = Math.max(rect.width * rect.height, 0);
      if (area <= 0 || label.length > 50_000) {
        continue;
      }
      const interactionRank =
        typeof element.onclick === "function"
          ? 3
          : element.matches('a[href], button, [role="button"]')
            ? 2
            : getComputedStyle(element).cursor === "pointer"
              ? 1
              : 0;
      const current = cardsByIndex.get(index);
      if (
        !current ||
        interactionRank > current.interactionRank ||
        (interactionRank === current.interactionRank && area < current.area)
      ) {
        cardsByIndex.set(index, {
          element,
          index,
          key: element,
          label:
            automationCore.normalizeText(metadata?.title) ||
            (textMatch ? label.replace(/^\d{1,3}(?:\s+|[.、])/, "") : label),
          visible: true,
          area,
          interactionRank,
        });
      }
    }
    return [...cardsByIndex.values()].sort(
      (left, right) => left.index - right.index,
    );
  }

  function readQianwenReferenceCardIndex(metadata) {
    const index = Number(metadata?.refer_num);
    if (Number.isInteger(index) && index > 0) {
      return index;
    }
    return null;
  }

  function findReferencePanelTrigger(answer) {
    const answerRect = answer.getBoundingClientRect();
    const candidates = [
      ...document.querySelectorAll(
        'button, [role="button"], [tabindex], a, div, span',
      ),
    ].flatMap((element) => {
      if (!isRendered(element) || state.host?.contains(element)) {
        return [];
      }
      const label = automationCore.normalizeText(
        element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.innerText,
      );
      if (automationCore.parseReferencePanelLabel(label) === null) {
        return [];
      }
      const rect = element.getBoundingClientRect();
      const horizontalGap =
        rect.right < answerRect.left
          ? answerRect.left - rect.right
          : answerRect.right < rect.left
            ? rect.left - answerRect.right
            : 0;
      const verticalGap =
        rect.bottom < answerRect.top
          ? answerRect.top - rect.bottom
          : answerRect.bottom < rect.top
            ? rect.top - answerRect.bottom
            : 0;
      const distance = horizontalGap + verticalGap;
      return [
        {
          element,
          label,
          visible: true,
          insideAnswer: answer.contains(element),
          nearAnswer: distance <= 600,
          distance,
          area: Math.max(rect.width * rect.height, 0),
        },
      ];
    });
    return automationCore.selectReferencePanelTrigger(candidates);
  }

  function collectRenderedReferenceLinks() {
    const candidates = document.querySelectorAll(
      "a[href], [data-href], [data-url], [data-link], [data-source-url]",
    );
    const linksByUrl = new Map();
    for (const element of candidates) {
      if (!isRendered(element) || state.host?.contains(element)) {
        continue;
      }
      const rawUrl =
        (element instanceof HTMLAnchorElement ? element.href : "") ||
        element.getAttribute("href") ||
        element.getAttribute("data-href") ||
        element.getAttribute("data-url") ||
        element.getAttribute("data-link") ||
        element.getAttribute("data-source-url");
      const url = core.normalizeHttpUrl(rawUrl, location.href);
      if (!url) {
        continue;
      }
      const parsed = new URL(url);
      if (
        parsed.origin === location.origin &&
        (parsed.pathname === "/chat" || parsed.pathname.startsWith("/chat/"))
      ) {
        continue;
      }
      if (!linksByUrl.has(url)) {
        linksByUrl.set(url, {
          key: element,
          url,
          label:
            core.normalizeText(element.innerText) ||
            core.normalizeText(element.getAttribute("aria-label")) ||
            core.normalizeText(element.getAttribute("title")) ||
            parsed.hostname,
          visible: true,
        });
      }
    }
    return [...linksByUrl.values()];
  }

  async function collapseReferencePanel(answer, trigger, links, runId) {
    const currentTrigger = trigger.element.isConnected
      ? trigger.element
      : findReferencePanelTrigger(answer)?.element;
    if (!currentTrigger) {
      throw new Error("AUTOMATION_REFERENCE_PANEL_CLOSE_FAILED");
    }
    currentTrigger.click();
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      if (state.automationRunId !== runId) {
        throw new Error("AUTOMATION_CANCELLED");
      }
      if (links.every((link) => !isRendered(link.key))) {
        await delay(100);
        return;
      }
      await delay(100);
    }
    throw new Error("AUTOMATION_REFERENCE_PANEL_CLOSE_FAILED");
  }

  function isReferencePanelCaptureError(error) {
    return (
      error instanceof Error &&
      error.message.startsWith("AUTOMATION_REFERENCE_PANEL_")
    );
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function highlightCandidate(candidate) {
    restoreCandidateOutline();
    state.candidate = candidate;
    state.originalOutline = candidate.style.outline;
    state.originalOutlineOffset = candidate.style.outlineOffset;
    candidate.style.outline = "3px solid #175cd3";
    candidate.style.outlineOffset = "3px";
  }

  function restoreCandidateOutline() {
    if (!state.candidate) {
      return;
    }
    state.candidate.style.outline = state.originalOutline;
    state.candidate.style.outlineOffset = state.originalOutlineOffset;
    state.candidate = null;
    state.originalOutline = "";
    state.originalOutlineOffset = "";
  }

  async function captureCandidate(
    candidate,
    prefilledHandoffCode = "",
    batchContext = null,
    preparedCapture = null,
  ) {
    const answerText =
      preparedCapture?.answerText ?? core.normalizeText(candidate.innerText);
    if (!answerText) {
      renderError("所选区域没有可见文本，请重新选择。");
      return;
    }

    const visibleLinks = [
      ...collectVisibleLinks(candidate),
      ...(preparedCapture?.additionalVisibleLinks ?? []),
    ];
    restoreCandidateOutline();
    candidate.scrollIntoView({ block: "center", inline: "nearest" });
    await nextPaint();
    const selectedRect = candidate.getBoundingClientRect();
    setHostVisible(false);

    try {
      await nextPaint();
      const screenshotResponse = await chrome.runtime.sendMessage({
        type: "WT_CAPTURE_VIEWPORT",
      });
      if (!screenshotResponse?.ok || !screenshotResponse.dataUrl) {
        throw new Error("CAPTURE_SCREENSHOT_FAILED");
      }
      const selectedRegionScreenshotDataUrl = await cropScreenshot(
        screenshotResponse.dataUrl,
        selectedRect,
      );
      state.payload = core.createDraftCapturePayload({
        userInitiated: true,
        pageOrigin: location.origin,
        pageUrl: location.href,
        pageTitle: document.title,
        observedAt: new Date().toISOString(),
        answerText,
        visibleLinks,
        selectedRegionScreenshotDataUrl,
      });
      setHostVisible(true);
    } catch {
      setHostVisible(true);
      if (batchContext && state.batchActive) {
        renderBatchFailure("截图生成失败，本项任务尚未提交。");
      } else {
        renderError("截图或预览生成失败。本次内容未导出，请重新选择。");
      }
      return;
    }
    if (batchContext && state.batchActive) {
      await submitBatchCapture(
        state.payload,
        prefilledHandoffCode,
        batchContext,
      );
    } else {
      renderPreview(state.payload, prefilledHandoffCode);
    }
  }

  async function submitBatchCapture(payload, handoffCode, batchContext) {
    renderAutomationProgress(
      `正在提交第 ${batchContext.completedTaskCount + 1} / ${batchContext.totalTaskCount} 项采集结果……`,
    );
    try {
      const response = await chrome.runtime.sendMessage({
        type: "WT_SUBMIT_CAPTURE",
        handoffCode,
        draft: createConfirmedPayload(payload),
      });
      if (!response?.ok) {
        renderBatchFailure(response?.error ?? "本项采集结果提交失败。");
        return;
      }
      if (!state.batchActive) {
        return;
      }
      state.payload = null;
      state.batchCompleted = Math.min(
        batchContext.completedTaskCount + 1,
        batchContext.totalTaskCount,
      );
      renderAutomationProgress(
        `第 ${state.batchCompleted} / ${batchContext.totalTaskCount} 项已提交，正在继续下一项……`,
      );
      setTimeout(() => {
        void runAutomationBatch();
      }, 700);
    } catch {
      renderBatchFailure("无法连接问天，本项采集结果尚未提交。");
    }
  }

  function collectVisibleLinks(container) {
    const anchors = [
      ...(container.matches("a[href]") ? [container] : []),
      ...container.querySelectorAll("a[href]"),
    ];
    return anchors.map((anchor) => ({
      url: anchor.href || anchor.getAttribute("href") || "",
      label:
        core.normalizeText(anchor.innerText) ||
        core.normalizeText(anchor.getAttribute("aria-label")),
      visible: isRendered(anchor),
    }));
  }

  function isRendered(element) {
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      element.getClientRects().length > 0 &&
      element.getAttribute("aria-hidden") !== "true"
    );
  }

  async function cropScreenshot(dataUrl, rect) {
    const image = await loadImage(dataUrl);
    const viewportWidth = Math.max(window.innerWidth, 1);
    const viewportHeight = Math.max(window.innerHeight, 1);
    const scaleX = image.naturalWidth / viewportWidth;
    const scaleY = image.naturalHeight / viewportHeight;
    const left = Math.max(0, Math.min(viewportWidth, rect.left));
    const top = Math.max(0, Math.min(viewportHeight, rect.top));
    const right = Math.max(left, Math.min(viewportWidth, rect.right));
    const bottom = Math.max(top, Math.min(viewportHeight, rect.bottom));
    const width = Math.round((right - left) * scaleX);
    const height = Math.round((bottom - top) * scaleY);

    if (width < 1 || height < 1) {
      throw new Error("CAPTURE_SELECTED_REGION_NOT_VISIBLE");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("CAPTURE_CANVAS_UNAVAILABLE");
    }
    context.drawImage(
      image,
      Math.round(left * scaleX),
      Math.round(top * scaleY),
      width,
      height,
      0,
      0,
      width,
      height,
    );
    return canvas.toDataURL("image/png");
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("CAPTURE_IMAGE_DECODE_FAILED"));
      image.src = dataUrl;
    });
  }

  function nextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function ensureUi() {
    if (state.host?.isConnected && state.shadow) {
      return state.shadow;
    }
    const host = document.createElement("div");
    host.dataset.wentianCaptureUi = "true";
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";
    const shadow = host.attachShadow({ mode: "closed" });
    document.documentElement.append(host);
    state.host = host;
    state.shadow = shadow;
    return shadow;
  }

  function renderInstruction() {
    const shadow = ensureUi();
    shadow.replaceChildren(createStyles());
    const bar = document.createElement("div");
    bar.className = "wt-bar";
    bar.textContent =
      "问天采集：移动鼠标并单击回答正文；蓝框应覆盖完整回答；按 Esc 取消";
    shadow.append(bar);
  }

  function renderCaptureProgress(message) {
    const shadow = ensureUi();
    shadow.replaceChildren(createStyles());
    const panel = document.createElement("section");
    panel.className = "wt-panel wt-small";
    const title = document.createElement("h2");
    title.textContent = "正在采集当前回答";
    const detail = document.createElement("p");
    detail.textContent = message;
    const close = document.createElement("button");
    close.className = "wt-button secondary";
    close.textContent = "取消";
    close.addEventListener("click", clearCaptureUi);
    const actions = document.createElement("div");
    actions.className = "wt-actions";
    actions.append(close);
    panel.append(title, detail, actions);
    shadow.append(panel);
  }

  function renderError(message) {
    const shadow = ensureUi();
    shadow.replaceChildren(createStyles());
    const panel = document.createElement("section");
    panel.className = "wt-panel wt-small";
    const title = document.createElement("h2");
    title.textContent = "本次采集未完成";
    const detail = document.createElement("p");
    detail.textContent = message;
    const actions = createActions([
      ["重新选择", beginSelection, "primary"],
      ["关闭", clearCaptureUi, "secondary"],
    ]);
    panel.append(title, detail, actions);
    shadow.append(panel);
  }

  function renderAutomationProgress(message) {
    const shadow = ensureUi();
    shadow.replaceChildren(createStyles());
    const panel = document.createElement("section");
    panel.className = "wt-panel wt-small";
    const title = document.createElement("h2");
    title.textContent = state.batchActive ? "整批连续采集中" : "自动提问进行中";
    const detail = document.createElement("p");
    detail.textContent = message;
    const cancel = document.createElement("button");
    cancel.className = "wt-button secondary";
    cancel.textContent = state.batchActive ? "停止整批" : "取消";
    cancel.addEventListener(
      "click",
      state.batchActive ? stopAutomationBatch : clearCaptureUi,
    );
    const actions = document.createElement("div");
    actions.className = "wt-actions";
    actions.append(cancel);
    panel.append(title, detail, actions);
    shadow.append(panel);
  }

  function renderAutomationFailure(message) {
    state.automationRunId += 1;
    const shadow = ensureUi();
    shadow.replaceChildren(createStyles());
    const panel = document.createElement("section");
    panel.className = "wt-panel wt-small";
    const title = document.createElement("h2");
    title.textContent = "自动提问未完成";
    const detail = document.createElement("p");
    detail.textContent = message;
    const actions = createActions([
      ["改用手动选择", beginSelection, "primary"],
      ["关闭", clearCaptureUi, "secondary"],
    ]);
    panel.append(title, detail, actions);
    shadow.append(panel);
  }

  function renderBatchFailure(message) {
    state.automationRunId += 1;
    const shadow = ensureUi();
    shadow.replaceChildren(createStyles());
    const panel = document.createElement("section");
    panel.className = "wt-panel wt-small";
    const title = document.createElement("h2");
    title.textContent = "整批采集已暂停";
    const detail = document.createElement("p");
    detail.textContent = message;
    const progress = document.createElement("p");
    progress.className = "wt-status";
    progress.textContent = state.batchTotal
      ? `已提交 ${state.batchCompleted} / ${state.batchTotal} 项。重试会从当前未完成项继续。`
      : "尚未取得批次进度，重试会重新领取下一项。";
    const actions = createActions([
      ["重试当前批次", () => void runAutomationBatch(), "primary"],
      ["停止整批", stopAutomationBatch, "secondary"],
    ]);
    panel.append(title, detail, progress, actions);
    shadow.append(panel);
  }

  function renderBatchComplete() {
    state.automationRunId += 1;
    state.batchActive = false;
    state.batchHandoffCode = "";
    const shadow = ensureUi();
    shadow.replaceChildren(createStyles());
    const panel = document.createElement("section");
    panel.className = "wt-panel wt-small";
    const title = document.createElement("h2");
    title.textContent = "整批采集完成";
    const detail = document.createElement("p");
    detail.textContent = `本批次已处理 ${state.batchCompleted} / ${state.batchTotal} 项。回答均已提交到问天，等待集中复核。`;
    const actions = createActions([["关闭", clearCaptureUi, "primary"]]);
    panel.append(title, detail, actions);
    shadow.append(panel);
  }

  function stopAutomationBatch() {
    state.automationRunId += 1;
    state.batchActive = false;
    state.batchHandoffCode = "";
    const shadow = ensureUi();
    shadow.replaceChildren(createStyles());
    const panel = document.createElement("section");
    panel.className = "wt-panel wt-small";
    const title = document.createElement("h2");
    title.textContent = "整批采集已停止";
    const detail = document.createElement("p");
    detail.textContent = `已提交 ${state.batchCompleted} / ${state.batchTotal || "?"} 项。回到问天可重新生成整批接入码并继续剩余任务。`;
    const actions = createActions([["关闭", clearCaptureUi, "primary"]]);
    panel.append(title, detail, actions);
    shadow.append(panel);
  }

  function renderPreview(payload, prefilledHandoffCode = "") {
    const shadow = ensureUi();
    shadow.replaceChildren(createStyles());
    const panel = document.createElement("section");
    panel.className = "wt-panel";

    const title = document.createElement("h2");
    title.textContent = "采集预览";
    const summary = document.createElement("p");
    summary.className = "wt-note";
    summary.textContent = `可见链接 ${payload.visible_citations.length} 条；文本信源提示 ${payload.source_mention_hints.length} 条。文本提示不会计入引用。`;

    const answerLabel = document.createElement("label");
    answerLabel.textContent = "回答正文";
    const answer = document.createElement("textarea");
    answer.readOnly = true;
    answer.value = payload.answer_text;

    const citations = createTextList(
      "页面内可见链接（可作为引用候选）",
      payload.visible_citations.map(
        (item) =>
          `${item.position}. ${item.label} — ${item.url}${
            item.observed_url ? `（页面链接：${item.observed_url}）` : ""
          }`,
      ),
      "所选区域未发现带URL的可见链接。",
    );
    const mentions = createTextList(
      "回答文本中的信源提示（非引用）",
      payload.source_mention_hints.map(
        (item) => `${item.position}. ${item.label}`,
      ),
      "未识别到文本信源提示。",
    );

    const screenshotLabel = document.createElement("div");
    screenshotLabel.className = "wt-label";
    screenshotLabel.textContent = "所选区域当前可见截图";
    const screenshot = document.createElement("img");
    screenshot.className = "wt-shot";
    screenshot.alt = "所选回答区域截图";
    screenshot.src = payload.screenshot.data_url;

    const handoffLabel = document.createElement("label");
    handoffLabel.textContent = "问天一次性接入码";
    const handoff = document.createElement("textarea");
    handoff.className = "wt-handoff";
    handoff.placeholder =
      "从问天任务页复制后粘贴到这里；接入码不会保存到浏览器。";
    handoff.value = prefilledHandoffCode;
    handoff.autocomplete = "off";
    handoff.spellcheck = false;

    const status = document.createElement("p");
    status.className = "wt-status";
    status.textContent = "尚未确认，也未上传。";
    const submit = document.createElement("button");
    submit.className = "wt-button primary";
    submit.textContent = "确认并提交到问天";
    submit.addEventListener("click", async () => {
      submit.disabled = true;
      status.textContent = "正在提交到本机问天……";
      try {
        const response = await chrome.runtime.sendMessage({
          type: "WT_SUBMIT_CAPTURE",
          handoffCode: handoff.value,
          draft: createConfirmedPayload(payload),
        });
        if (!response?.ok) {
          submit.disabled = false;
          status.textContent = response?.error ?? "提交失败，请重试。";
          return;
        }
        handoff.value = "";
        handoff.disabled = true;
        status.textContent = "已提交到问天，当前等待你回到问天完成最终确认。";
      } catch {
        submit.disabled = false;
        status.textContent = "无法连接问天，请确认问天正在运行后重试。";
      }
    });
    const exportButton = document.createElement("button");
    exportButton.className = "wt-button secondary";
    exportButton.textContent = "改为导出本地 JSON";
    exportButton.addEventListener("click", () => {
      downloadCapture(payload);
      status.textContent = "已导出本地 JSON，尚未提交到问天。";
    });
    const reselect = document.createElement("button");
    reselect.className = "wt-button secondary";
    reselect.textContent = "重新选择";
    reselect.addEventListener("click", beginSelection);
    const discard = document.createElement("button");
    discard.className = "wt-button secondary";
    discard.textContent = "丢弃";
    discard.addEventListener("click", clearCaptureUi);
    const actions = document.createElement("div");
    actions.className = "wt-actions";
    actions.append(submit, exportButton, reselect, discard);

    panel.append(
      title,
      summary,
      answerLabel,
      answer,
      citations,
      mentions,
      screenshotLabel,
      screenshot,
      handoffLabel,
      handoff,
      status,
      actions,
    );
    shadow.append(panel);
  }

  function createTextList(titleText, items, emptyText) {
    const section = document.createElement("section");
    const title = document.createElement("div");
    title.className = "wt-label";
    title.textContent = titleText;
    const list = document.createElement("ol");
    if (items.length === 0) {
      const item = document.createElement("li");
      item.textContent = emptyText;
      list.append(item);
    } else {
      for (const text of items) {
        const item = document.createElement("li");
        item.textContent = text;
        list.append(item);
      }
    }
    section.append(title, list);
    return section;
  }

  function createActions(definitions) {
    const actions = document.createElement("div");
    actions.className = "wt-actions";
    for (const [label, handler, style] of definitions) {
      const button = document.createElement("button");
      button.className = `wt-button ${style}`;
      button.textContent = label;
      button.addEventListener("click", handler);
      actions.append(button);
    }
    return actions;
  }

  function createStyles() {
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .wt-bar, .wt-panel { pointer-events: auto; box-sizing: border-box; color: #101828; background: #fff; box-shadow: 0 12px 40px rgba(16,24,40,.24); }
      .wt-bar { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 12px 18px; border: 2px solid #175cd3; border-radius: 10px; font-size: 14px; font-weight: 600; }
      .wt-panel { position: fixed; inset: 24px; max-width: 920px; margin: auto; overflow: auto; padding: 24px; border: 1px solid #d0d5dd; border-radius: 14px; }
      .wt-panel.wt-small { inset: auto 24px 24px auto; width: min(420px, calc(100vw - 48px)); }
      h2 { margin: 0 0 12px; font-size: 20px; }
      p { line-height: 1.6; }
      label, .wt-label { display: block; margin: 18px 0 8px; font-size: 14px; font-weight: 700; }
      textarea { box-sizing: border-box; width: 100%; min-height: 220px; resize: vertical; padding: 12px; border: 1px solid #98a2b3; border-radius: 8px; background: #f9fafb; color: #101828; font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
      textarea.wt-handoff { min-height: 84px; background: #fff; }
      ol { max-height: 180px; overflow: auto; margin: 0; padding-left: 24px; font-size: 13px; line-height: 1.6; word-break: break-all; }
      .wt-note { margin: 0; padding: 10px 12px; border-radius: 8px; background: #eff8ff; color: #175cd3; font-size: 13px; }
      .wt-shot { display: block; max-width: 100%; max-height: 320px; border: 1px solid #d0d5dd; border-radius: 8px; object-fit: contain; background: #f2f4f7; }
      .wt-status { color: #475467; font-size: 13px; }
      .wt-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
      .wt-button { appearance: none; padding: 9px 14px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; font-size: 14px; font-weight: 600; }
      .wt-button.primary { background: #175cd3; color: #fff; }
      .wt-button.secondary { border-color: #98a2b3; background: #fff; color: #344054; }
      .wt-button:disabled { cursor: not-allowed; opacity: .55; }
    `;
    return style;
  }

  function downloadCapture(payload) {
    const confirmedPayload = createConfirmedPayload(payload);
    const blob = new Blob([JSON.stringify(confirmedPayload, null, 2)], {
      type: "application/json",
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `wentian-doubao-capture-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);
  }

  function createConfirmedPayload(payload) {
    return {
      ...payload,
      confirmation_status: "confirmed_local_export",
      confirmed_at: new Date().toISOString(),
    };
  }

  function stopSelectionListeners() {
    state.active = false;
    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("click", handleSelectionClick, true);
  }

  function setHostVisible(visible) {
    if (state.host) {
      state.host.style.display = visible ? "block" : "none";
    }
  }

  function clearCaptureUi() {
    state.automationRunId += 1;
    state.batchActive = false;
    state.batchHandoffCode = "";
    state.batchTotal = 0;
    state.batchCompleted = 0;
    stopSelectionListeners();
    document.removeEventListener("keydown", handleKeyDown, true);
    restoreCandidateOutline();
    state.host?.remove();
    state.host = null;
    state.shadow = null;
    state.payload = null;
  }
})(globalThis);
