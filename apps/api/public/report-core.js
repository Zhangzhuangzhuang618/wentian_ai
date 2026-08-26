(function installWentianReportCore(globalScope) {
  if (globalScope.WentianReportCore) return;

  function summarizeTasks(tasks) {
    const statusCounts = {};
    for (const task of tasks ?? []) {
      const status = String(task?.status ?? "unknown");
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    }
    return Object.freeze({
      total: (tasks ?? []).length,
      confirmed: statusCounts.confirmed ?? 0,
      needsReview: statusCounts.needs_review ?? 0,
      rejected: statusCounts.rejected ?? 0,
      statusCounts: Object.freeze({ ...statusCounts }),
    });
  }

  function aggregateDomains(rankings) {
    const counts = new Map();
    for (const ranking of rankings ?? []) {
      for (const item of ranking ?? []) {
        const domain = String(item?.registrable_domain ?? "").trim();
        const displayOrigin =
          String(item?.display_origin ?? "").trim() || domain;
        const count = Number(
          item?.formal_source_entry_count ?? item?.entry_count ?? 0,
        );
        if (!domain || !Number.isInteger(count) || count <= 0) continue;
        const current = counts.get(domain) ?? {
          entryCount: 0,
          originCounts: new Map(),
        };
        current.entryCount += count;
        current.originCounts.set(
          displayOrigin,
          (current.originCounts.get(displayOrigin) ?? 0) + count,
        );
        counts.set(domain, current);
      }
    }
    const sorted = [...counts.entries()].sort(
      ([leftDomain, left], [rightDomain, right]) =>
        right.entryCount - left.entryCount ||
        leftDomain.localeCompare(rightDomain),
    );
    const total = sorted.reduce(
      (sum, [, domain]) => sum + domain.entryCount,
      0,
    );
    return Object.freeze(
      sorted.map(([registrableDomain, domain], index) => {
        const displayOrigin = [...domain.originCounts.entries()].sort(
          ([leftOrigin, leftCount], [rightOrigin, rightCount]) =>
            rightCount - leftCount || leftOrigin.localeCompare(rightOrigin),
        )[0]?.[0];
        return Object.freeze({
          position: index + 1,
          registrableDomain,
          displayOrigin,
          entryCount: domain.entryCount,
          share: total === 0 ? 0 : domain.entryCount / total,
        });
      }),
    );
  }

  function buildNaturalReport(input) {
    const questions = input?.questions ?? [];
    const tasks = input?.tasks ?? [];
    const rankings = input?.rankings ?? [];
    const rankingByQuestion = new Map(
      rankings.map((ranking) => [ranking.query_snapshot_item_id, ranking]),
    );
    const questionModels = questions.map((question) => {
      const questionTasks = tasks.filter(
        (task) => task.query_snapshot_item_id === question.id,
      );
      const taskSummary = summarizeTasks(questionTasks);
      const ranking = rankingByQuestion.get(question.id) ?? {
        total_formal_source_entries: 0,
        ranking: [],
      };
      const totalEntries = Number(ranking.total_formal_source_entries) || 0;
      return Object.freeze({
        id: question.id,
        text: question.text,
        taskSummary,
        totalEntries,
        uniqueDomainCount: ranking.ranking.length,
        averageEntriesPerConfirmedSample:
          taskSummary.confirmed === 0
            ? null
            : totalEntries / taskSummary.confirmed,
        topDomain:
          ranking.ranking[0]?.display_origin ??
          ranking.ranking[0]?.registrable_domain ??
          null,
        ranking: Object.freeze([...ranking.ranking]),
      });
    });
    const domains = aggregateDomains(
      questionModels.map((question) => question.ranking),
    );
    const taskSummary = summarizeTasks(tasks);
    const totalEntries = questionModels.reduce(
      (sum, question) => sum + question.totalEntries,
      0,
    );
    const questionsWithSources = questionModels.filter(
      (question) => question.totalEntries > 0,
    ).length;
    return Object.freeze({
      taskSummary,
      totalEntries,
      uniqueDomainCount: domains.length,
      questionCount: questionModels.length,
      questionsWithSources,
      sourceQuestionRate:
        questionModels.length === 0
          ? 0
          : questionsWithSources / questionModels.length,
      domains,
      questions: Object.freeze(questionModels),
    });
  }

  function buildComparisonReport(input) {
    const report = input?.report ?? { questions: [] };
    const questionNames = input?.questionNames ?? {};
    const questions = (report.questions ?? []).map((question) =>
      Object.freeze({
        ...question,
        text:
          questionNames[question.query_snapshot_item_id] ??
          question.query_snapshot_item_id,
      }),
    );
    const available = questions.filter(
      (question) => question.availability === "available",
    );
    const averageOverlap =
      available.length === 0
        ? null
        : available.reduce((sum, question) => sum + question.overlap.value, 0) /
          available.length;
    return Object.freeze({
      naturalTaskSummary: summarizeTasks(input?.naturalTasks ?? []),
      nominationTaskSummary: summarizeTasks(input?.nominationTasks ?? []),
      availableQuestionCount: available.length,
      questionCount: questions.length,
      averageOverlap,
      citedDomains: aggregateDomains(
        questions.map((question) => question.citation_ranking.domains),
      ),
      nominatedDomains: aggregateDomains(
        questions.map((question) => question.nomination_ranking.domains),
      ),
      questions: Object.freeze(questions),
    });
  }

  globalScope.WentianReportCore = Object.freeze({
    aggregateDomains,
    buildComparisonReport,
    buildNaturalReport,
    summarizeTasks,
  });
})(globalThis);
