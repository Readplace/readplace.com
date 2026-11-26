---
title: "How one reader caught a missing walkthrough"
description: "A reader reported that a saved Silent Hill f collectibles guide stopped after its introduction. The parser had picked a 556-word introduction as the article, which passed the 100-word check. A prototype that checks the reader copy against each section of the source recovered all 7 sections in a replay."
excerpt: "A saved collectibles guide kept its introduction and credits, and lost every location."
tldr: "A reader reported that a saved Silent Hill f collectibles guide showed only part of the page. The parser had picked the 556-word introduction as the main article, which passed the 100-word check, and the collectible locations were missing. A prototype now checks that the reader copy holds the instructions from each section it can identify in the source, and rebuilds the copy in order when sections are missing. It recovered all 7 sections in a replay. Production rollout and repair of the reported article are still ahead."
slug: "how-one-reader-caught-a-missing-walkthrough"
date: "2026-11-25"
author: "Fayner Brack"
keywords: "read it later game guides, save walkthrough to read later, reader view missing content, silent hill f collectibles guide, article extraction missing sections, readplace"
---

“Not all of the page is shown,” a reader wrote about a Silent Hill f collectibles guide. They were right. Readplace showed the introduction, explained the guide’s colour coding, and stopped at the credits. The collectible locations were missing.

We reproduced the failure by feeding our parser that same introduction followed by 6 guide sections. It picked the introduction as the main article and returned the exact 556 words we had published. That was enough to pass our 100-word check.

The report led us to test a fix: after extraction, check that the reader copy contains the instructions from each section we can identify in the source. If sections are missing, rebuild the copy in order and check it again. The prototype recovered all 7 sections in our replay. Production rollout and repair of the reported article are still ahead.
