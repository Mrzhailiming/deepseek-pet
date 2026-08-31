
    //#region 插件体

    /** 需要的浏览器服务：slot 系统 + Conversation Definition 注册表。 */
    var inject = ["slots", "conversationEvents"];

    /**
     * 浏览器插件体。
     * @param ctx - client 根 context。
     */
    function apply(ctx) {
      prewarmStateCache();
      var config = resolveConfig();
      if (!config.enabled) return;

      installStyles();

      var store = createPetStore(config);
      var gate = createFeedGate(config);
      ctx.effect(function () {
        return function () { store.dispose(); };
      }, "dsh-pet-plugin: store");

      /**
       * 每条喂食事件自成一个 Context：id 用 seq，role 恒为 start，所以
       * start 对每条事件最多被引擎调用一次（引擎对同一 Context 的第二个
       * start 会抛错），重放由 gate 兜住。state-only，不声明 target，
       * publication 取 "none" —— 本 Definition 不产出任何视图节点。
       *
       * 三类喂食事件之外还认一类**只观察不喂食**的事件（tool/call）：技能与
       * 记忆是从「你在用哪个工具」长出来的，而那个名字只有 tool/call 才有。
       * 它走同一道 gate，所以翻历史 / 重放同样不会重复记账。
       */
      var petFeedDefinition = {
        kind: "dsh-pet-feed",
        match: function (event) {
          if (classify(event) === null && observeToolCall(event) === null) return null;
          return { id: "seq-" + String(event.seq), role: "start" };
        },
        start: function (_context, match) {
          var event = match.event;
          var classified = classify(event);
          var call = observeToolCall(event);
          if ((classified !== null || call !== null) && gate.admit(event)) {
            var now = Date.now();
            if (call !== null) store.observeTool(call, now);
            // tool/result 既喂食又要看成没成，两件事都做。
            var result = observeToolResult(event);
            if (result !== null) store.observeToolResult(result, now);
            if (classified !== null) {
              store.feed(classified.source, classified.tokens, now, classified.output);
            }
          }
          return { seq: event.seq };
        },
        update: function (context) { return context.state; },
        publication: function () { return "none"; }
      };

      ctx.effect(
        function () { return ctx.conversationEvents.register(petFeedDefinition); },
        "dsh-pet-plugin: feed observer"
      );

      // overlay 恒注册：effectsEnabled 管的是「飞行特效」（store.feed / snack 里
      // 那层守卫），不是宠物卡片本身——卡片上还有主动喂食的入口，关了特效也得留着。
      ctx.slots.inject("shell.overlay", function () {
        return ctx.slots.register({
          name: "shell.overlay",
          id: "pet",
          order: 50
        }, createPetOverlay(store, config));
      });
    }

    //#endregion
