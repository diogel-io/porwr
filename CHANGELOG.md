# Changelog

## [0.3.2](https://github.com/diogel-io/porwr/compare/v0.3.1...v0.3.2) (2026-10-31)


### Bug Fixes

* **contacts:** bound the unencrypted contact cache ([#426](https://github.com/diogel-io/porwr/issues/426)) ([e289cf4](https://github.com/diogel-io/porwr/commit/e289cf4d9614e919406398b8173c47140a760f48))

## [0.3.1](https://github.com/diogel-io/porwr/compare/v0.3.0...v0.3.1) (2026-10-31)


### Features

* **media:** publish the Blossom server as the account's kind 10063 list ([#418](https://github.com/diogel-io/porwr/issues/418)) ([69937fe](https://github.com/diogel-io/porwr/commit/69937fe38b917bf2560bd413a90599e438f0d1b1))


### Bug Fixes

* **media:** show a spinner while Media Management loads the Blossom server ([#421](https://github.com/diogel-io/porwr/issues/421)) ([aa87ab6](https://github.com/diogel-io/porwr/commit/aa87ab6a1c14ca5a39cd616a4062f31367512397))
* **quick-publish:** send a plain event to the background so Firefox can sign it ([#411](https://github.com/diogel-io/porwr/issues/411)) ([#412](https://github.com/diogel-io/porwr/issues/412)) ([f64493a](https://github.com/diogel-io/porwr/commit/f64493a0fb42207073474ce06b8b1080907bcb9b))


### Reverts

* remove the Qodana workflow until it is configured ([#419](https://github.com/diogel-io/porwr/issues/419)) ([aacc986](https://github.com/diogel-io/porwr/commit/aacc986ecb5202ab10cda3cdc47a8817e68a4b49))

## [0.3.0](https://github.com/diogel-io/porwr/compare/v0.2.0...v0.3.0) (2026-10-28)


### ⚠ BREAKING CHANGES

* **zaps:** window.nostr.diogel.getZapCapabilities and window.nostr.diogel.sendZap are removed. Sites zap by having Porwr sign their kind 9734 zap request and paying through window.webln.

### Features

* **accounts:** open the Dashboard after switching account in the main window ([#398](https://github.com/diogel-io/porwr/issues/398)) ([c458f7f](https://github.com/diogel-io/porwr/commit/c458f7f45b7f1a27ed6a781fa82f15fa30bd826f))
* add a NIP-89 client tag to Quick Publish notes ([#254](https://github.com/diogel-io/porwr/issues/254)) ([aaa112a](https://github.com/diogel-io/porwr/commit/aaa112a592563ccffd12fad1ac5dbf485a38a55b)), closes [#226](https://github.com/diogel-io/porwr/issues/226)
* **contacts:** cache contacts and profiles in the background for Contacts and Messaging ([#257](https://github.com/diogel-io/porwr/issues/257)) ([#259](https://github.com/diogel-io/porwr/issues/259)) ([e44e7e5](https://github.com/diogel-io/porwr/commit/e44e7e56bed91d1f5f8d9757a4d40990154ac64c))
* **keys:** add breadcrumbs back to the Keys list from its sub-pages ([#302](https://github.com/diogel-io/porwr/issues/302)) ([#306](https://github.com/diogel-io/porwr/issues/306)) ([b642250](https://github.com/diogel-io/porwr/commit/b64225010321a08b123e8935f30917eae3e1e830))
* **keys:** move vault backup and restore to a card on the Keys page ([#297](https://github.com/diogel-io/porwr/issues/297)) ([#299](https://github.com/diogel-io/porwr/issues/299)) ([d30228d](https://github.com/diogel-io/porwr/commit/d30228db230fd9bfdb87ca840640ef9da14eeb11))
* **keys:** rename the vault card's Import and Export to Restore and Backup ([#393](https://github.com/diogel-io/porwr/issues/393)) ([348b947](https://github.com/diogel-io/porwr/commit/348b947773dca60b3df86edc1eac5fc0a27df325)), closes [#390](https://github.com/diogel-io/porwr/issues/390)
* **keys:** rename the vault export page to Vault Backup and rewrite its copy ([#395](https://github.com/diogel-io/porwr/issues/395)) ([7febddc](https://github.com/diogel-io/porwr/commit/7febddcbf50a9f5dd15a333c278b63888996559a))
* **keys:** rename the vault import page to Vault Restore and rewrite its copy ([#394](https://github.com/diogel-io/porwr/issues/394)) ([dd9111a](https://github.com/diogel-io/porwr/commit/dd9111a3e67d6cfdd7377436970be4b6bd41381e))
* **keys:** show the security warning as a corner icon with a panel ([#298](https://github.com/diogel-io/porwr/issues/298)) ([#300](https://github.com/diogel-io/porwr/issues/300)) ([d5a515b](https://github.com/diogel-io/porwr/commit/d5a515b8edc07f97690fe430529b6e77ce45cdcd))
* let users hold back remote profile images until they choose to load them ([#362](https://github.com/diogel-io/porwr/issues/362)) ([4ccdea0](https://github.com/diogel-io/porwr/commit/4ccdea0a94faddef7ddfd8d5dc3a24a4600cb977))
* **media:** move the Blossom server setting to a Media Management page ([#233](https://github.com/diogel-io/porwr/issues/233)) ([e4aa87c](https://github.com/diogel-io/porwr/commit/e4aa87c35023de2ecd6293be9af07aeb3e49edcd))
* **messaging:** check that DM relays keep gift wraps before publishing them ([#277](https://github.com/diogel-io/porwr/issues/277)) ([#283](https://github.com/diogel-io/porwr/issues/283)) ([2e9263e](https://github.com/diogel-io/porwr/commit/2e9263e6f94e1c2f165477fe36bf583c894f3591))
* **messaging:** list conversations, not every contact, with Chats and Requests tabs ([#258](https://github.com/diogel-io/porwr/issues/258)) ([#261](https://github.com/diogel-io/porwr/issues/261)) ([9f4357e](https://github.com/diogel-io/porwr/commit/9f4357e684a2178e0d9bc8310309769f747033ff))
* **messaging:** publish direct message relays (kind 10050) from the Relays page ([#235](https://github.com/diogel-io/porwr/issues/235)) ([d69ade1](https://github.com/diogel-io/porwr/commit/d69ade1fac1895b491cfc2d06b3c62c4c102015d))
* **messaging:** show a loading spinner until Messages has loaded conversations ([#399](https://github.com/diogel-io/porwr/issues/399)) ([738fcde](https://github.com/diogel-io/porwr/commit/738fcde2e1801ceae26d75cf061c332795574412))
* **navigation:** move Keys and Settings to the navigation footer ([#294](https://github.com/diogel-io/porwr/issues/294)) ([#295](https://github.com/diogel-io/porwr/issues/295)) ([31a39c2](https://github.com/diogel-io/porwr/commit/31a39c2f2d2d49d89e6ff03613783bd5f50970d7))
* **profile:** redesign the Profile page as one column with one Save ([#260](https://github.com/diogel-io/porwr/issues/260)) ([3b303f2](https://github.com/diogel-io/porwr/commit/3b303f22824b7f9920235c3fa92f5b21063f8acd))
* **profile:** show a copyable npub on the panel profile card ([#303](https://github.com/diogel-io/porwr/issues/303)) ([#305](https://github.com/diogel-io/porwr/issues/305)) ([94dbe74](https://github.com/diogel-io/porwr/commit/94dbe74061ecab878e900683ffee65666f43b1b6))
* **relays:** move Profile Search Relays to the Relays page ([#263](https://github.com/diogel-io/porwr/issues/263)) ([#264](https://github.com/diogel-io/porwr/issues/264)) ([736e460](https://github.com/diogel-io/porwr/commit/736e460429635cb2a7f2654b9f0d11bbfa053298))
* **sidebar:** recognise kind 16 generic reposts in approval requests ([#329](https://github.com/diogel-io/porwr/issues/329)) ([#332](https://github.com/diogel-io/porwr/issues/332)) ([c0d0a42](https://github.com/diogel-io/porwr/commit/c0d0a42c4a79246ba358203109abf93126be3eff))
* **sidebar:** recognise NIP-98 HTTP authentication in the approval prompt ([#223](https://github.com/diogel-io/porwr/issues/223)) ([7d67b87](https://github.com/diogel-io/porwr/commit/7d67b87a575fd381068d1f9e6dbda07f0deb0fe8)), closes [#215](https://github.com/diogel-io/porwr/issues/215)
* **sites:** show and disconnect Connected Sites per account ([#309](https://github.com/diogel-io/porwr/issues/309)) ([#310](https://github.com/diogel-io/porwr/issues/310)) ([bed50e5](https://github.com/diogel-io/porwr/commit/bed50e504e41f147804ddacfd0a6d0b778fed51d))
* **support:** explain which DM relays keep private messages ([#278](https://github.com/diogel-io/porwr/issues/278)) ([#279](https://github.com/diogel-io/porwr/issues/279)) ([b416fee](https://github.com/diogel-io/porwr/commit/b416fee39216eb576310f8de91a16d502c250fa7))
* **support:** replace the Support link with an in-app NIP-17 support chat ([#228](https://github.com/diogel-io/porwr/issues/228)) ([#275](https://github.com/diogel-io/porwr/issues/275)) ([ef80568](https://github.com/diogel-io/porwr/commit/ef80568ae1a5c01881f000bd1aa3fadc7e8c2184))
* **vault:** explain export on its own page and save the backup through a Save As dialog ([#314](https://github.com/diogel-io/porwr/issues/314)) ([#316](https://github.com/diogel-io/porwr/issues/316)) ([ed9f5af](https://github.com/diogel-io/porwr/commit/ed9f5af8dabc762ecc8dd2ca6c338e942ca46a4d))
* **vault:** explain import on its own page and check the backup's password first ([#313](https://github.com/diogel-io/porwr/issues/313)) ([#315](https://github.com/diogel-io/porwr/issues/315)) ([e345fcf](https://github.com/diogel-io/porwr/commit/e345fcfd89e8d617e25cd1f01626ecb49ec3af24))
* **vault:** remove the Export current vault first link from the Import vault page ([#317](https://github.com/diogel-io/porwr/issues/317)) ([#318](https://github.com/diogel-io/porwr/issues/318)) ([4c70407](https://github.com/diogel-io/porwr/commit/4c7040781b5ca747761134f7927e63b326a6f4ca))
* **wallet:** connect Alby Hub and Coinos without pasting a connection string ([#110](https://github.com/diogel-io/porwr/issues/110)) ([#262](https://github.com/diogel-io/porwr/issues/262)) ([3880cea](https://github.com/diogel-io/porwr/commit/3880cea7538097627a5b1b294714b6c0d57504ce))
* **zaps:** remove Porwr-originated zaps ([#271](https://github.com/diogel-io/porwr/issues/271)) ([#274](https://github.com/diogel-io/porwr/issues/274)) ([b952eb0](https://github.com/diogel-io/porwr/commit/b952eb0d0196f02d767ebcb1b38f92d99068f5ad))
* **zaps:** support client-built zaps through getRelays, the zap request preview and WebLN ([#270](https://github.com/diogel-io/porwr/issues/270)) ([#273](https://github.com/diogel-io/porwr/issues/273)) ([4e59353](https://github.com/diogel-io/porwr/commit/4e593536b06713266dadb39be9cab081f2e5b174))


### Bug Fixes

* **approvals:** enforce grant limits in the background and clean up grants with their owner ([#339](https://github.com/diogel-io/porwr/issues/339)) ([98ddbd5](https://github.com/diogel-io/porwr/commit/98ddbd58098e36bd625813a9433a948eda481b02))
* bound the approval queue per site and globally, and cap page payload sizes ([#380](https://github.com/diogel-io/porwr/issues/380)) ([5925566](https://github.com/diogel-io/porwr/commit/59255663360169775cfc1f883d8342b7609af9f3))
* cap NIP-04 direct message signing grants at 8 hours ([#375](https://github.com/diogel-io/porwr/issues/375)) ([df44b9b](https://github.com/diogel-io/porwr/commit/df44b9b80c91dc9da06c23f359939ed1bb793432))
* connect a self-hosted Alby Hub over http on the home network ([#363](https://github.com/diogel-io/porwr/issues/363)) ([74b7143](https://github.com/diogel-io/porwr/commit/74b7143892162bcb5b78723821e437b56b7a6b05))
* **connected-sites:** separate the account name from its key in "Signs as" ([#327](https://github.com/diogel-io/porwr/issues/327)) ([f8577cd](https://github.com/diogel-io/porwr/commit/f8577cd28c1bd30a0251ea4bf8c383275d4eb176)), closes [#325](https://github.com/diogel-io/porwr/issues/325)
* **dashboard:** show local approvals in Recent Activity and log each request once (workspace[#37](https://github.com/diogel-io/porwr/issues/37)) ([#319](https://github.com/diogel-io/porwr/issues/319)) ([fa743d2](https://github.com/diogel-io/porwr/commit/fa743d2b9d99914072e87c5f6452de15abad259e))
* **dev:** load the type-check overlay without an inline script ([#250](https://github.com/diogel-io/porwr/issues/250)) ([f5db215](https://github.com/diogel-io/porwr/commit/f5db215f3acb140f25165d0cdef57ebb7d0ba28d)), closes [#249](https://github.com/diogel-io/porwr/issues/249)
* harden relay, Blossom and NIP-47 transport ([#357](https://github.com/diogel-io/porwr/issues/357)) ([1c194e5](https://github.com/diogel-io/porwr/commit/1c194e5342fcfc0133c44cef8f7a2b62a0c0d061))
* keep wallet and Blossom server text away from sites and local storage ([#384](https://github.com/diogel-io/porwr/issues/384)) ([11d0d0b](https://github.com/diogel-io/porwr/commit/11d0d0ba7237a7323444431d1ce5c6193e10cdb2))
* **keys:** allow spaces in the profile name when adding a key ([#231](https://github.com/diogel-io/porwr/issues/231)) ([a741f84](https://github.com/diogel-io/porwr/commit/a741f844c4d938f8984a3afa97a0c5722c2c9f2a)), closes [#230](https://github.com/diogel-io/porwr/issues/230)
* **keys:** cap imported ncryptsec scrypt cost, measure export passwords after NFKC, share the password minimum ([#342](https://github.com/diogel-io/porwr/issues/342)) ([fea8ebd](https://github.com/diogel-io/porwr/commit/fea8ebd24d57f298ab3411397d47a3cef06e8464))
* **keys:** export keys as NIP-49 ncryptsec and enforce the vault password minimum in the background ([#341](https://github.com/diogel-io/porwr/issues/341)) ([6218b3a](https://github.com/diogel-io/porwr/commit/6218b3a3eae0d5edd8dc58cf8c0023c89c534992))
* make one-click wallet connection work in Firefox ([#364](https://github.com/diogel-io/porwr/issues/364)) ([f21b411](https://github.com/diogel-io/porwr/commit/f21b411d92e85d8597a9e7a9345e7c29069e1c37))
* **messaging:** give each Direct Message Relays load its own relay pool ([#288](https://github.com/diogel-io/porwr/issues/288)) ([#290](https://github.com/diogel-io/porwr/issues/290)) ([bf32ac6](https://github.com/diogel-io/porwr/commit/bf32ac691c305436c55c2f15487e52a44278ef33))
* **messaging:** load Direct Message Relays within 4 s and only stop retries that could repeat work ([#265](https://github.com/diogel-io/porwr/issues/265)) ([#269](https://github.com/diogel-io/porwr/issues/269)) ([4b2dc1c](https://github.com/diogel-io/porwr/commit/4b2dc1cbe2a838978e82af52d6804b5373d28777))
* **messaging:** report a message as sent only once a relay keeps it ([#276](https://github.com/diogel-io/porwr/issues/276)) ([#281](https://github.com/diogel-io/porwr/issues/281)) ([5dce3db](https://github.com/diogel-io/porwr/commit/5dce3db83c1aa2cbc73486347d6385fadfef23ed))
* **messaging:** save Direct Message Relays when a relay is slow or unreachable ([#265](https://github.com/diogel-io/porwr/issues/265)) ([#266](https://github.com/diogel-io/porwr/issues/266)) ([9500e00](https://github.com/diogel-io/porwr/commit/9500e0085ee07ebae5a3402f28d8d39fb59c8e18))
* **messaging:** stop a failed relay connection reading as "no DM relays" ([#282](https://github.com/diogel-io/porwr/issues/282)) ([df2aa14](https://github.com/diogel-io/porwr/commit/df2aa1494b637ead93ce8ecad904cbe7c88d8b63))
* **navigation:** open extension menu items on their real paths, and prove NIP-17 interop ([#239](https://github.com/diogel-io/porwr/issues/239)) ([987f889](https://github.com/diogel-io/porwr/commit/987f889fee3e07145ebfb13aeb284835a6d5396f)), closes [#227](https://github.com/diogel-io/porwr/issues/227)
* **nip47:** refuse to publish a payment once the vault has locked ([#383](https://github.com/diogel-io/porwr/issues/383)) ([02023b6](https://github.com/diogel-io/porwr/commit/02023b674e686770319a85faaa15e4ed5d3ed5d1))
* **profile:** paint an empty banner in the theme colour, not orange ([#301](https://github.com/diogel-io/porwr/issues/301)) ([#307](https://github.com/diogel-io/porwr/issues/307)) ([daf0f7d](https://github.com/diogel-io/porwr/commit/daf0f7dbd1f30d4088fc9582346ef7d2f5b258e6))
* **profile:** publish an uploaded banner or avatar only to its own account ([#401](https://github.com/diogel-io/porwr/issues/401)) ([218c147](https://github.com/diogel-io/porwr/commit/218c1477f0f1b387b6974e7bc2639d06d46195fe))
* **quick-publish:** tell a failed relay lookup from no relay list, and retry ([#285](https://github.com/diogel-io/porwr/issues/285)) ([#293](https://github.com/diogel-io/porwr/issues/293)) ([defdbc4](https://github.com/diogel-io/porwr/commit/defdbc4f4f327925462797c7935fdf1ecab18770))
* **relays:** close relay sockets whose connection attempt timed out ([#287](https://github.com/diogel-io/porwr/issues/287)) ([#289](https://github.com/diogel-io/porwr/issues/289)) ([3c37d3a](https://github.com/diogel-io/porwr/commit/3c37d3a0751b171c81f99f79f559c3d87fcb13ff))
* security hardening batch (key export, NIP-47 pool, pubkey validation, website links) ([#379](https://github.com/diogel-io/porwr/issues/379)) ([0c19158](https://github.com/diogel-io/porwr/commit/0c191585ce9e255ac6b4ed1aacbd44c81a932aef))
* **security:** allow localhost scripts only in dev builds ([#248](https://github.com/diogel-io/porwr/issues/248)) ([0db30fa](https://github.com/diogel-io/porwr/commit/0db30fa071f08ecfd7b45246716d7990c192d230))
* **security:** only Porwr's own pages may use the privileged channel ([#241](https://github.com/diogel-io/porwr/issues/241)) ([9f4ad8f](https://github.com/diogel-io/porwr/commit/9f4ad8f20b48f2b74cda9e6cc4ce961fe89b638f)), closes [#240](https://github.com/diogel-io/porwr/issues/240)
* **security:** sign in the background, not in Porwr's pages ([#242](https://github.com/diogel-io/porwr/issues/242)) ([08e8eb2](https://github.com/diogel-io/porwr/commit/08e8eb26111909f613681eafe55981cf2d8473fb)), closes [#240](https://github.com/diogel-io/porwr/issues/240)
* **security:** stop returning secrets to Porwr's pages ([#243](https://github.com/diogel-io/porwr/issues/243)) ([de099eb](https://github.com/diogel-io/porwr/commit/de099ebcefa427da15d65ed8c42e365115a17c27)), closes [#240](https://github.com/diogel-io/porwr/issues/240)
* **security:** stop sending a placeholder mnemonic and passphrase into new vaults ([#256](https://github.com/diogel-io/porwr/issues/256)) ([caeaf51](https://github.com/diogel-io/porwr/commit/caeaf51fe184d3068e9366d08cb96a1c4dd5ae20)), closes [#244](https://github.com/diogel-io/porwr/issues/244)
* **security:** stop storing the raw vault key where extension pages can read it ([#255](https://github.com/diogel-io/porwr/issues/255)) ([b28eaca](https://github.com/diogel-io/porwr/commit/b28eaca60165f08779c732c881ccaf2b88280cbd)), closes [#245](https://github.com/diogel-io/porwr/issues/245)
* **security:** take a site's origin from the browser, not the content script ([#251](https://github.com/diogel-io/porwr/issues/251)) ([b7ff9ef](https://github.com/diogel-io/porwr/commit/b7ff9ef7f601efec440899c0cbb7ce41c2e896fc)), closes [#246](https://github.com/diogel-io/porwr/issues/246)
* **sidebar:** hold the idle view until the queue has been read ([#381](https://github.com/diogel-io/porwr/issues/381)) ([1a217f1](https://github.com/diogel-io/porwr/commit/1a217f10f3dad25a9b39ea0ad955954ce8c5b958))
* **sidebar:** label kind 10050 and treat it as elevated ([#322](https://github.com/diogel-io/porwr/issues/322)) ([#333](https://github.com/diogel-io/porwr/issues/333)) ([8f8c4ed](https://github.com/diogel-io/porwr/commit/8f8c4ed6a2e10dcfe733cd4fe6c5d2cb90110d8f))
* **sidebar:** name the signing account on requests that waited out a locked vault ([#326](https://github.com/diogel-io/porwr/issues/326)) ([3697bb7](https://github.com/diogel-io/porwr/commit/3697bb701296cef1391941461548c0f70424834b)), closes [#320](https://github.com/diogel-io/porwr/issues/320)
* **sidebar:** point the empty panel to the Keys page, matching its button ([#328](https://github.com/diogel-io/porwr/issues/328)) ([2172dbd](https://github.com/diogel-io/porwr/commit/2172dbdf0f8c6facec089d33ba6051d0841935dd)), closes [#324](https://github.com/diogel-io/porwr/issues/324)
* **sidebar:** show the expired and interrupted notice until dismissed (workspace[#97](https://github.com/diogel-io/porwr/issues/97)) ([#312](https://github.com/diogel-io/porwr/issues/312)) ([3e029fb](https://github.com/diogel-io/porwr/commit/3e029fb9b278fde42dee38283b5187c9eaac2d76))
* **sidebar:** start each view at the top of the panel ([#321](https://github.com/diogel-io/porwr/issues/321)) ([#331](https://github.com/diogel-io/porwr/issues/331)) ([2167c6d](https://github.com/diogel-io/porwr/commit/2167c6d4eb44d17febf6f171a8f3528d21dfa1cb))
* **sidebar:** summarise a repost request instead of printing its embedded note ([#323](https://github.com/diogel-io/porwr/issues/323)) ([#330](https://github.com/diogel-io/porwr/issues/330)) ([f912ff8](https://github.com/diogel-io/porwr/commit/f912ff8dded45ec9adf38f69fe16aff845ec600a))
* **sidebar:** switch to the request chosen from the pending list ([#334](https://github.com/diogel-io/porwr/issues/334)) ([#365](https://github.com/diogel-io/porwr/issues/365)) ([2eb2175](https://github.com/diogel-io/porwr/commit/2eb2175813d9fd408de5ea776432a893c6d7ea08))
* stop ImageUploader leaking a storage listener on every Profile visit ([#253](https://github.com/diogel-io/porwr/issues/253)) ([e269015](https://github.com/diogel-io/porwr/commit/e269015afeda2aaab86ac9d1e7d3ea4376074048)), closes [#252](https://github.com/diogel-io/porwr/issues/252)
* **storage:** keep grants, bindings and auto-lock state out of content-script storage ([#340](https://github.com/diogel-io/porwr/issues/340)) ([801446e](https://github.com/diogel-io/porwr/commit/801446e586be7ac12a39480a31826441c220667f))
* **vault:** let a lock during an unlock win, and keep an open vault open on a failed unlock ([#386](https://github.com/diogel-io/porwr/issues/386)) ([37b6fa4](https://github.com/diogel-io/porwr/commit/37b6fa47e7156e071fea1172fe8fb5d60f3ec02f))
* **vault:** let a lock during vault creation win ([#387](https://github.com/diogel-io/porwr/issues/387)) ([888607d](https://github.com/diogel-io/porwr/commit/888607d896281a0625b2cfb1f41131ba25a3bdf5))
* **wallet:** give each account its own wallet connections ([#304](https://github.com/diogel-io/porwr/issues/304)) ([#308](https://github.com/diogel-io/porwr/issues/308)) ([0ffc000](https://github.com/diogel-io/porwr/commit/0ffc000ed2453704f3510ca88cc8caab9173d1e2))
* **wallet:** open the wallet popup from a throwaway connect window (workspace[#76](https://github.com/diogel-io/porwr/issues/76)) ([#296](https://github.com/diogel-io/porwr/issues/296)) ([038f879](https://github.com/diogel-io/porwr/commit/038f8798351246d97d96b1ca142f3e41d08f4556))
* **wallet:** say websites can request payments through WebLN ([#292](https://github.com/diogel-io/porwr/issues/292)) ([95d7443](https://github.com/diogel-io/porwr/commit/95d744380cd4f6ff90c656a912a9db996cfeaced))
* **webln:** honour the duration chosen when enabling WebLN ([#382](https://github.com/diogel-io/porwr/issues/382)) ([639e9c3](https://github.com/diogel-io/porwr/commit/639e9c3674656248d0883d6e0c229d3d150119e4))
* **webln:** tell a site when sendPayment is given no invoice ([#389](https://github.com/diogel-io/porwr/issues/389)) ([fa74ae5](https://github.com/diogel-io/porwr/commit/fa74ae5e2adca70e87b4c5b5a5d4525bb7b01c9a)), closes [#388](https://github.com/diogel-io/porwr/issues/388)

## [0.2.0](https://github.com/diogel-io/porwr/compare/v0.1.1...v0.2.0) (2026-10-03)

### Features

- **sites:** say when a site is connected as another account, and offer to switch ([#216](https://github.com/diogel-io/porwr/issues/216)) ([192f91e](https://github.com/diogel-io/porwr/commit/192f91ee79aaa53e9a3f1335a81b239ff7413f10))

## [0.1.1](https://github.com/threenine/diogel/compare/v0.1.0...v0.1.1) (2026-08-26)

### Bug Fixes

- **accounts:** follow the vault's lock state instead of hydrating once ([#213](https://github.com/threenine/diogel/issues/213)) ([c07847d](https://github.com/threenine/diogel/commit/c07847da796631ec67c13af9f0762a864d3ac0f9)), closes [#211](https://github.com/threenine/diogel/issues/211)

## [0.1.0](https://github.com/threenine/diogel/compare/v0.0.32...v0.1.0) (2026-08-22)

### Features

- **approvals:** replace the singleton approval with a durable request queue ([#138](https://github.com/threenine/diogel/issues/138)) ([3d53908](https://github.com/threenine/diogel/commit/3d53908ff92453c077256e44804a3154708ce6e2))
- **dashboard:** show and revoke what each site holds ([#178](https://github.com/threenine/diogel/issues/178)) ([32cc860](https://github.com/threenine/diogel/commit/32cc86030866f387097065fba436130ad1662390)), closes [#116](https://github.com/threenine/diogel/issues/116)
- **security:** act as the bound account in encryption and zap handlers ([#165](https://github.com/threenine/diogel/issues/165)) ([2a52b48](https://github.com/threenine/diogel/commit/2a52b485798dbc5f60838e7384863b48ccd0a71e)), closes [#116](https://github.com/threenine/diogel/issues/116)
- **security:** key permission grants by account ([#166](https://github.com/threenine/diogel/issues/166)) ([1fd49b1](https://github.com/threenine/diogel/commit/1fd49b100ea2b2c6e449d63daeb8342bbbe302be)), closes [#116](https://github.com/threenine/diogel/issues/116)
- **security:** sign as the account a site is bound to ([#164](https://github.com/threenine/diogel/issues/164)) ([b48ea58](https://github.com/threenine/diogel/commit/b48ea58a423b7900f5fefeff71e9f7bbc9ad462d))
- **sidebar:** add panel presence, the toolbar badge, and page-gone handling ([#157](https://github.com/threenine/diogel/issues/157)) ([bb1d630](https://github.com/threenine/diogel/commit/bb1d6308d640a2fa0c83d2ab4143a89b2c0def38)), closes [#113](https://github.com/threenine/diogel/issues/113)
- **sidebar:** add the account switcher and fix the approved-clients count ([#179](https://github.com/threenine/diogel/issues/179)) ([8ef9c65](https://github.com/threenine/diogel/commit/8ef9c65589bfa9cb2cf896621220db25115eee6a)), closes [#116](https://github.com/threenine/diogel/issues/116)
- **sidebar:** build the cross-browser panel foundation ([#137](https://github.com/threenine/diogel/issues/137)) ([a248a43](https://github.com/threenine/diogel/commit/a248a432bc0a7a3d7d87b8529e424303ed408ca7))
- **sidebar:** complete the panel header with lock and pending count ([#150](https://github.com/threenine/diogel/issues/150)) ([f135527](https://github.com/threenine/diogel/commit/f13552735b4a4df1df0291fa9ca9c4bbfd5c0690)), closes [#147](https://github.com/threenine/diogel/issues/147)
- **sidebar:** create the vault in the panel, and hide the footer while locked ([#199](https://github.com/threenine/diogel/issues/199)) ([d026d6f](https://github.com/threenine/diogel/commit/d026d6f2e759ef251b408d7f55f007ab01ad1532))
- **sidebar:** cross-check panel presence against the browser ([#174](https://github.com/threenine/diogel/issues/174)) ([22c89c0](https://github.com/threenine/diogel/commit/22c89c037be2b3ffb65b26ab25d4dba9abe8cd78)), closes [#113](https://github.com/threenine/diogel/issues/113)
- **sidebar:** deliver signing approvals and vault unlock in the panel ([#139](https://github.com/threenine/diogel/issues/139)) ([d849b01](https://github.com/threenine/diogel/commit/d849b01405c7943c235fc0423f188f8f8c8c0259))
- **sidebar:** push queue state to the panel instead of polling ([#167](https://github.com/threenine/diogel/issues/167)) ([37d9f8d](https://github.com/threenine/diogel/commit/37d9f8d423fdd30e14091ef102431c533e27fd3e)), closes [#140](https://github.com/threenine/diogel/issues/140)
- **sidebar:** show the footer as icons with the label on hover and focus ([#187](https://github.com/threenine/diogel/issues/187)) ([979d787](https://github.com/threenine/diogel/commit/979d7875ead8039dcf900b341584ddc7282696bf)), closes [#184](https://github.com/threenine/diogel/issues/184)
- **sidebar:** show the full profile in the panel, and keep it current ([#202](https://github.com/threenine/diogel/issues/202)) ([211fa24](https://github.com/threenine/diogel/commit/211fa24fda0d43cdbd8757892b9cc0d65dd9c266)), closes [#201](https://github.com/threenine/diogel/issues/201)
- **theme:** take slate-200 for the light header and invert the badge ([#156](https://github.com/threenine/diogel/issues/156)) ([6cfe983](https://github.com/threenine/diogel/commit/6cfe98310f6348d7ff65c98e6670aa60c05ad801)), closes [#153](https://github.com/threenine/diogel/issues/153)
- **types:** add Pubkey and RelayUrl branded value objects ([#129](https://github.com/threenine/diogel/issues/129)) ([5e173b7](https://github.com/threenine/diogel/commit/5e173b727a3c83dab2608df150b242702703b85b))

### Bug Fixes

- **bex:** answer null instead of withholding the reply ([#197](https://github.com/threenine/diogel/issues/197)) ([742911a](https://github.com/threenine/diogel/commit/742911ac0436fa0d8d8f9b5888f9a99116dec641)), closes [#195](https://github.com/threenine/diogel/issues/195)
- **bex:** route the panel's own actions through the dispatcher ([#186](https://github.com/threenine/diogel/issues/186)) ([429b6c8](https://github.com/threenine/diogel/commit/429b6c82f7f646313da2915fc66bf8cb90d61872)), closes [#177](https://github.com/threenine/diogel/issues/177) [#113](https://github.com/threenine/diogel/issues/113)
- **build:** declare the Node range the toolchain will accept, and pin 24.19.0 ([#205](https://github.com/threenine/diogel/issues/205)) ([518aa19](https://github.com/threenine/diogel/commit/518aa19b7eb657ad6eab86246395d4f837aaf2f5))
- **porwr:** key permission grants on the normalised origin ([#190](https://github.com/threenine/diogel/issues/190)) ([c2fc8d8](https://github.com/threenine/diogel/commit/c2fc8d85fd4601cccc92f00b4d6326e26e596899))
- **security:** split the no-kind and any-kind meanings in permission grants ([#163](https://github.com/threenine/diogel/issues/163)) ([32d0a91](https://github.com/threenine/diogel/commit/32d0a917de5f54ad19ba89333d7513846c10cce5)), closes [#136](https://github.com/threenine/diogel/issues/136)
- **sidebar:** inset the panel column once ([#151](https://github.com/threenine/diogel/issues/151)) ([07f5220](https://github.com/threenine/diogel/commit/07f5220024393394419fe6c866fa87ff7a80441a))
- **sidebar:** reduce the footer to Dashboard, Keys and Settings ([#183](https://github.com/threenine/diogel/issues/183)) ([3d3d6bc](https://github.com/threenine/diogel/commit/3d3d6bca1af379fd0068223ccf25bf30df5e322c)), closes [#182](https://github.com/threenine/diogel/issues/182)
- **sidebar:** settle the panel boot and stop offering to unlock nothing ([#160](https://github.com/threenine/diogel/issues/160)) ([0f693f6](https://github.com/threenine/diogel/commit/0f693f6c2bd7fd7f376b96348c48815aad789180)), closes [#158](https://github.com/threenine/diogel/issues/158)
- **sidebar:** source the active tab origin from the content script ([#155](https://github.com/threenine/diogel/issues/155)) ([50b367f](https://github.com/threenine/diogel/commit/50b367f07d6af0604af9f780d2a1a1a783a37d14)), closes [#154](https://github.com/threenine/diogel/issues/154)
- **sidebar:** stop the header squeezing the account identity ([#189](https://github.com/threenine/diogel/issues/189)) ([be243cd](https://github.com/threenine/diogel/commit/be243cd50ef8fe3f827eb3eee372cc80b5344c01)), closes [#188](https://github.com/threenine/diogel/issues/188)
- **sidebar:** stop vault actions navigating the panel to the dashboard ([#181](https://github.com/threenine/diogel/issues/181)) ([74541b0](https://github.com/threenine/diogel/commit/74541b03a0c005af4864f3dd4c950bcf4fb21520)), closes [#116](https://github.com/threenine/diogel/issues/116)
- **theme:** interpolate --header-bg so application chrome renders a background ([#149](https://github.com/threenine/diogel/issues/149)) ([6c7881e](https://github.com/threenine/diogel/commit/6c7881e02f6505c8fa0e871fc10f66626b2f6d44))

## v0.0.32

[compare changes](https://github.com/threenine/diogel/compare/v0.0.31...v0.0.32)

### 🩹 Fixes

- **profile:** Prevent overwriting picture and banner with undefined during profile updates ([b18850b](https://github.com/threenine/diogel/commit/b18850b))

### 🏡 Chore

- **docs:** Update README with improved description and fix minor typos ([aa1db65](https://github.com/threenine/diogel/commit/aa1db65))

### ❤️ Contributors

- Gary Woodfine <gary.woodfine@threenine.co.uk>

## v0.0.31

[compare changes](https://github.com/threenine/diogel/compare/v0.0.30...v0.0.31)

### 🏡 Chore

- **docs:** Remove NIP-02 contact list and feedback design documents ([9d5862f](https://github.com/threenine/diogel/commit/9d5862f))

### ❤️ Contributors

- Gary Woodfine <gary.woodfine@threenine.co.uk>

## v0.0.30

[compare changes](https://github.com/threenine/diogel/compare/v0.0.29...v0.0.30)

### 🏡 Chore

- Remove redundant type assertions in bridge responses for cleaner and consistent handler code ([56f839f](https://github.com/threenine/diogel/commit/56f839f))

### ❤️ Contributors

- Gary Woodfine <lnb0l9dc@duck.com>

## v0.0.29

[compare changes](https://github.com/threenine/diogel/compare/v0.0.28...v0.0.29)

## v0.0.28

[compare changes](https://github.com/threenine/diogel/compare/v0.0.27...v0.0.28)

### 🏡 Chore

- **docs:** Add Chrome and Firefox store links, remove GitHub warning in README.md ([08757db](https://github.com/threenine/diogel/commit/08757db))
- **release:** V0.0.24 ([dfc58f5](https://github.com/threenine/diogel/commit/dfc58f5))
- **release:** V0.0.25 ([17388e1](https://github.com/threenine/diogel/commit/17388e1))
- **release:** V0.0.26 ([f0a2a4a](https://github.com/threenine/diogel/commit/f0a2a4a))
- **release:** V0.0.27 ([051ef36](https://github.com/threenine/diogel/commit/051ef36))

### ❤️ Contributors

- Gary Woodfine <gary.woodfine@threenine.co.uk>

## v0.0.27

[compare changes](https://github.com/threenine/diogel/compare/v0.0.27...v0.0.27)

## v0.0.26

[compare changes](https://github.com/threenine/diogel/compare/v0.0.25...v0.0.26)

## v0.0.25

[compare changes](https://github.com/threenine/diogel/compare/v0.0.24...v0.0.25)

## v0.0.24

[compare changes](https://github.com/threenine/diogel/compare/v0.0.23...v0.0.24)

### 🏡 Chore

- **docs:** Remove NIP-44 implementation plan following feature completion ([2e3f2ed](https://github.com/threenine/diogel/commit/2e3f2ed))

### ❤️ Contributors

- Gary Woodfine <gary.woodfine@threenine.co.uk>

## v0.0.23

[compare changes](https://github.com/threenine/diogel/compare/v0.0.22...v0.0.23)

### 🏡 Chore

- Remove redundant blank lines in useNavigation.ts ([3411e12](https://github.com/threenine/diogel/commit/3411e12))
- **security:** Enforce strict target origin for postMessage and improve window message validation ([0db8884](https://github.com/threenine/diogel/commit/0db8884))
- **docs:** Update Diogel link and banner in README.md ([2e53b8b](https://github.com/threenine/diogel/commit/2e53b8b))
- **ui:** Adjust spacing in AccountDropdown for better alignment ([3e823c2](https://github.com/threenine/diogel/commit/3e823c2))
- **i18n:** Update import key caption with clarification on private key storage ([5b0d527](https://github.com/threenine/diogel/commit/5b0d527))

### ❤️ Contributors

- Gary Woodfine <gary.woodfine@threenine.co.uk>

## v0.0.22

[compare changes](https://github.com/threenine/diogel/compare/v0.0.21...v0.0.22)

### 🚀 Enhancements

- Show account avatars in dropdown ([bfb3c88](https://github.com/threenine/diogel/commit/bfb3c88))

### 🩹 Fixes

- Avoid overlapping account avatar fallback ([b753f5f](https://github.com/threenine/diogel/commit/b753f5f))
- Resolve logo asset in extension popup ([0ffec4f](https://github.com/threenine/diogel/commit/0ffec4f))
- Guard extension logo asset resolution ([4c8d7c5](https://github.com/threenine/diogel/commit/4c8d7c5))
- Inline Diogel logo svg ([d354acd](https://github.com/threenine/diogel/commit/d354acd))
- Bundle theme logo image assets ([189fa8d](https://github.com/threenine/diogel/commit/189fa8d))

### 🏡 Chore

- **docs:** Remove outdated documentation files ([9c84038](https://github.com/threenine/diogel/commit/9c84038))
- **manifest:** Update web_accessible_resources and fix logo path handling ([72b31ea](https://github.com/threenine/diogel/commit/72b31ea))

### ❤️ Contributors

- Dave <support@threenine.co.uk>
- Gary Woodfine <gary.woodfine@threenine.co.uk>

## v0.0.21

[compare changes](https://github.com/threenine/diogel/compare/v0.0.20...v0.0.21)

### 🏡 Chore

- **dependencies:** Update package-lock.json to reflect dependency changes for v0.0.20 upgrade ([64b366f](https://github.com/threenine/diogel/commit/64b366f))

### ❤️ Contributors

- Gary Woodfine <gary.woodfine@threenine.co.uk>

## v0.0.20

[compare changes](https://github.com/threenine/diogel/compare/v0.0.19...v0.0.20)

### 🚀 Enhancements

- Add new dashboard-specific CSS variables for light and dark themes ([f21d458](https://github.com/threenine/diogel/commit/f21d458))
- Enhance `DashboardLayout` with responsive drawer and improved styles ([a8ac6bb](https://github.com/threenine/diogel/commit/a8ac6bb))
- Add shared CSS primitives for dashboard components ([07cb0c9](https://github.com/threenine/diogel/commit/07cb0c9))
- Implement initial `DashboardPage` with responsive widget placeholders and route integration ([55ad092](https://github.com/threenine/diogel/commit/55ad092))
- Add route aliases and navigation updates for improved ProfilePage UX ([1fbc214](https://github.com/threenine/diogel/commit/1fbc214))
- Create dedicated KeyManagementPage and update navigation ([eca34bb](https://github.com/threenine/diogel/commit/eca34bb))
- Create dedicated RelayManagementPage and update navigation ([5fa600b](https://github.com/threenine/diogel/commit/5fa600b))
- Add navigation logic for dashboard widgets and improve active key handling ([3efcbd2](https://github.com/threenine/diogel/commit/3efcbd2))
- Add unit tests and implementation for `dashboard-service` ([a1391e8](https://github.com/threenine/diogel/commit/a1391e8))
- Add dashboard widgets for Active Keys, Connected Relays, Recent Activity, and Total Signed Events ([0aa24be](https://github.com/threenine/diogel/commit/0aa24be))
- Enhance Recent Activity widget with improved activity details and styling ([9fb54da](https://github.com/threenine/diogel/commit/9fb54da))
- Enhance Recent Activity widget with improved activity details and styling ([13c3435](https://github.com/threenine/diogel/commit/13c3435))
- Add Quick Sign feature with preview and signing functionality ([b5ee3a3](https://github.com/threenine/diogel/commit/b5ee3a3))
- Enhance Connected Relays widget and improve dashboard-service ([4dbd4d0](https://github.com/threenine/diogel/commit/4dbd4d0))
- Add utility links, new signature action, and update dashboard layout ([1878fb2](https://github.com/threenine/diogel/commit/1878fb2))
- Revamp Quick Sign feature with broader kind support, relay integration, and enhanced UX ([5d73203](https://github.com/threenine/diogel/commit/5d73203))
- Refine Quick Sign relay handling and UI enhancements ([a45d8a4](https://github.com/threenine/diogel/commit/a45d8a4))
- Enhance relay discovery logic and unit tests ([61d0751](https://github.com/threenine/diogel/commit/61d0751))
- Improve Quick Sign UX with structured input, tags, and kind-specific validation ([dc37edd](https://github.com/threenine/diogel/commit/dc37edd))
- Enhance Quick Sign UX and testing with relay publishing improvements ([bee0fab](https://github.com/threenine/diogel/commit/bee0fab))
- Enhance Quick Sign with direct signing, relay handling, and improved error messaging ([c15e494](https://github.com/threenine/diogel/commit/c15e494))
- Add account alias and pubkey to recent activity tracking ([7057b8e](https://github.com/threenine/diogel/commit/7057b8e))
- Enhance activity icon resolution and status styles in RecentActivityCard ([5f07198](https://github.com/threenine/diogel/commit/5f07198))
- Introduce key management features with import, generation, and view functionality ([db0f474](https://github.com/threenine/diogel/commit/db0f474))
- Enhance i18n support for key management pages ([512a40c](https://github.com/threenine/diogel/commit/512a40c))
- Update i18n key for quick sign title to "Quick Publish" ([0c5a1e1](https://github.com/threenine/diogel/commit/0c5a1e1))
- Improve alias input layout and update save button label ([21632c1](https://github.com/threenine/diogel/commit/21632c1))
- Update `DashboardFooter` styles and improve main navigation consistency ([1ffccc9](https://github.com/threenine/diogel/commit/1ffccc9))
- Add "rejected" status support for recent activity ([3559dbf](https://github.com/threenine/diogel/commit/3559dbf))
- Enhance date formatting fallback and update status styles ([c8f4bce](https://github.com/threenine/diogel/commit/c8f4bce))
- Update i18n key captions and adjust layout styles ([ef09784](https://github.com/threenine/diogel/commit/ef09784))
- Add security warning to `KeyManagementPage` and improve key management UX ([901d716](https://github.com/threenine/diogel/commit/901d716))
- Enhance date handling in `KeyManagementTable` and add unit test ([2f5cc7b](https://github.com/threenine/diogel/commit/2f5cc7b))
- Improve `KeyManagementTable` public key display and add unit tests ([a4bedc2](https://github.com/threenine/diogel/commit/a4bedc2))
- Integrate `SecurityWarning` component into `ViewKeyPage` ([f7bd85c](https://github.com/threenine/diogel/commit/f7bd85c))
- Add `bot` flag and `birthday` properties to `NostrProfile` type ([90f34f6](https://github.com/threenine/diogel/commit/90f34f6))
- Update ProfileEditor with `bot` toggle and `birthday` input fields ([375311e](https://github.com/threenine/diogel/commit/375311e))
- Add validation for `birthday` fields in ProfileEditor ([b0f4796](https://github.com/threenine/diogel/commit/b0f4796))
- Add NIP-05 verification support to ProfileEditor ([de0062b](https://github.com/threenine/diogel/commit/de0062b))
- Add unit tests for ProfileEditor and ProfilePage components ([5d4c7a5](https://github.com/threenine/diogel/commit/5d4c7a5))
- Add `xl` size to DiogelLogo and update VaultLogin design ([d34502d](https://github.com/threenine/diogel/commit/d34502d))
- Add LoginLayout and update routing for login page ([3eaec22](https://github.com/threenine/diogel/commit/3eaec22))
- Introduce `ExtensionNavigation` component and streamline navigation logic ([0788a7c](https://github.com/threenine/diogel/commit/0788a7c))
- Add `useEventService` composable for handling Nostr event subscription ([a496ba7](https://github.com/threenine/diogel/commit/a496ba7))
- Add new relay URL to `RELAY_SEEDS` list ([a7c7ee1](https://github.com/threenine/diogel/commit/a7c7ee1))
- Fetch signed event count via relay subscription ([16a5f52](https://github.com/threenine/diogel/commit/16a5f52))
- Add `Kind` enum and `ListKinds` array to define event types ([6c0f4d6](https://github.com/threenine/diogel/commit/6c0f4d6))
- Replace local activity logs with relay-based event retrieval ([46c8024](https://github.com/threenine/diogel/commit/46c8024))
- Create ApprovedClientsCard component for dashboard widget ([c6e775c](https://github.com/threenine/diogel/commit/c6e775c))
- Add Blossom upload service and integrate with ImageUploader ([0508278](https://github.com/threenine/diogel/commit/0508278))

### 🩹 Fixes

- Update i18n strings and format adjustment in ActiveKeysCard template ([1e5b32e](https://github.com/threenine/diogel/commit/1e5b32e))
- Adjust RecentActivityCard to fetch 9 items instead of 4 for dashboard summary ([146bf57](https://github.com/threenine/diogel/commit/146bf57))
- Improve readability of security warning message in en-US i18n ([2e23eac](https://github.com/threenine/diogel/commit/2e23eac))
- Update en-US i18n key for save button text ([39232e6](https://github.com/threenine/diogel/commit/39232e6))
- Update ProfilePreview banner image fit from "cover" to "contain" for better rendering ([c0dcd7b](https://github.com/threenine/diogel/commit/c0dcd7b))
- Update support and documentation links in DashboardNavigation ([b4ab618](https://github.com/threenine/diogel/commit/b4ab618))

### 💅 Refactors

- Replace MainLayout with DashboardLayout and update routes ([780d790](https://github.com/threenine/diogel/commit/780d790))
- Replace MainLayoutHeader with DashboardHeader and improve dashboard styles ([9c37ff9](https://github.com/threenine/diogel/commit/9c37ff9))
- Replace `MainNavigation` with `DashboardNavigation` and enhance navigation functionality ([d681fe2](https://github.com/threenine/diogel/commit/d681fe2))
- Update `ProfilePage` layout and styles for dashboard consistency ([665533b](https://github.com/threenine/diogel/commit/665533b))
- Update `ExtensionSettings` layout and styles for dashboard alignment ([24e2a99](https://github.com/threenine/diogel/commit/24e2a99))
- Update `ViewLogs` layout and styles for dashboard alignment ([f40ccce](https://github.com/threenine/diogel/commit/f40ccce))
- Update `EditAccount` layout and styles for dashboard alignment ([530f5f0](https://github.com/threenine/diogel/commit/530f5f0))
- Update `app.scss` for dashboard style consistency ([562817f](https://github.com/threenine/diogel/commit/562817f))
- Update dashboard captions for improved clarity and consistency ([a8d79df](https://github.com/threenine/diogel/commit/a8d79df))
- Rename `message` column to `hostname` in `ViewLogs` table configuration ([77b63b5](https://github.com/threenine/diogel/commit/77b63b5))
- Enhance key hydration and log fetching logic in `EditAccount` and `ViewLogs` ([4c174d1](https://github.com/threenine/diogel/commit/4c174d1))
- Simplify `ProfilePage` tab panel structure and cleanup redundant card nesting ([0798264](https://github.com/threenine/diogel/commit/0798264))
- Enhance dashboard styles and improve responsive behavior ([ce92c90](https://github.com/threenine/diogel/commit/ce92c90))
- Rename `logs` route and related references to `event-history` ([c6361d6](https://github.com/threenine/diogel/commit/c6361d6))
- Improve dashboard grid layout with responsive design updates ([8d5f90c](https://github.com/threenine/diogel/commit/8d5f90c))
- Update Quick Sign service, validation logic, and tests ([d7f9d4b](https://github.com/threenine/diogel/commit/d7f9d4b))
- Simplify dashboard card templates by removing unused badges and captions, and adjust icon sizes for consistency ([969b027](https://github.com/threenine/diogel/commit/969b027))
- Update RecentActivityCard status i18n keys and enhance responsive table layout ([df1e27f](https://github.com/threenine/diogel/commit/df1e27f))
- Remove unused `statusText` computed property from dashboard cards ([c6f3ed7](https://github.com/threenine/diogel/commit/c6f3ed7))
- Update `/create-account` route to redirect to `add-new-key` and adjust references ([e0607ec](https://github.com/threenine/diogel/commit/e0607ec))
- Rename `MainLayoutFooter` to `DashboardFooter` and update references ([e008cd2](https://github.com/threenine/diogel/commit/e008cd2))
- Restructure public key cell layout in `KeyManagementTable` ([95c83bc](https://github.com/threenine/diogel/commit/95c83bc))
- Extract `SecurityWarning` component and update key management styles ([0af0763](https://github.com/threenine/diogel/commit/0af0763))
- Update `DiogelLogo` across components with consistent `lg` size ([40c42e2](https://github.com/threenine/diogel/commit/40c42e2))
- Move navigation-related types to a dedicated file for reuse ([44764cb](https://github.com/threenine/diogel/commit/44764cb))
- Adjust type exports and paths for bridge modules ([7499d69](https://github.com/threenine/diogel/commit/7499d69))
- Update type imports and extensions for consistency across modules ([28102a3](https://github.com/threenine/diogel/commit/28102a3))
- Move `env.d.ts` to `types` directory for better file organization ([7073549](https://github.com/threenine/diogel/commit/7073549))
- Update type imports for consistency across navigation modules ([7a90d62](https://github.com/threenine/diogel/commit/7a90d62))
- Rename `Kind.d.ts` to `kind.d.ts` for consistency ([5ae0f55](https://github.com/threenine/diogel/commit/5ae0f55))
- Enhance event deduplication in `getEvents` and adjust activity limit in `getDashboardSummary` ([7adf578](https://github.com/threenine/diogel/commit/7adf578))
- Replace local state with props in dashboard widgets for consistency ([9fe4c68](https://github.com/threenine/diogel/commit/9fe4c68))
- Centralize fallback relay handling and replace inline logic with reusable methods ([9dc83f4](https://github.com/threenine/diogel/commit/9dc83f4))
- Move `DashboardSummary` type definition to `src/types` for improved modularity ([245b88b](https://github.com/threenine/diogel/commit/245b88b))
- Remove database updates for account renaming in `dexie-storage` ([32c9f5f](https://github.com/threenine/diogel/commit/32c9f5f))
- Migrate account alias updates and enhance relay handling in tests ([4b6b74a](https://github.com/threenine/diogel/commit/4b6b74a))
- Replace "Total Signed Events" with "Approved Clients" metric ([bf83584](https://github.com/threenine/diogel/commit/bf83584))
- Remove redundant delay logic in Blossom upload handler ([4dd27d4](https://github.com/threenine/diogel/commit/4dd27d4))
- Reorder imports, adjust type definitions, and update icon size in dashboard components ([bad7426](https://github.com/threenine/diogel/commit/bad7426))
- Improve Blossom upload handler to ensure consistent spinner state ([aad6c19](https://github.com/threenine/diogel/commit/aad6c19))

### 📖 Documentation

- Add visual review checklist for Package H dashboard work ([0850284](https://github.com/threenine/diogel/commit/0850284))
- Add dashboard shortcomings review with gate results and limitations summary ([e39fc4e](https://github.com/threenine/diogel/commit/e39fc4e))

### 🏡 Chore

- Remove obsolete dashboard UI specs (`dashboard-ui.md`) ([563a063](https://github.com/threenine/diogel/commit/563a063))
- Remove pnpm lock file to clean up dependency management ([c73b955](https://github.com/threenine/diogel/commit/c73b955))
- Remove unused `APP_VERSION` variable from `DashboardFooter` component ([ae7a1b9](https://github.com/threenine/diogel/commit/ae7a1b9))
- Update localization strings and improve key clarity, adjust ProfileView UI to include key export link ([375bc7d](https://github.com/threenine/diogel/commit/375bc7d))
- Temporarily comment out unused new signature button in DashboardNavigation footer ([e1767de](https://github.com/threenine/diogel/commit/e1767de))
- Remove Diogel-related assets and dependencies ([b6e57cf](https://github.com/threenine/diogel/commit/b6e57cf))
- Remove `pnpm-lock.yaml` file to clean up obsolete dependencies ([685f721](https://github.com/threenine/diogel/commit/685f721))
- Remove `DiogelLogo` usage from ExtensionWindowHeader ([8d12e45](https://github.com/threenine/diogel/commit/8d12e45))

### ✅ Tests

- Improve dashboard and quick sign service unit tests ([859d6e0](https://github.com/threenine/diogel/commit/859d6e0))
- Expand unit tests for validateQuickSignContent with markdown and HTML scenarios ([068ac80](https://github.com/threenine/diogel/commit/068ac80))
- Add unit tests for RecentActivityCard and dashboard service enhancements ([e6a0650](https://github.com/threenine/diogel/commit/e6a0650))
- Add unit tests for `renameAlias` in `dexie-storage` service ([ca9484e](https://github.com/threenine/diogel/commit/ca9484e))
- Add unit tests for `ImportKeyForm` component ([62feabb](https://github.com/threenine/diogel/commit/62feabb))
- Add unit tests for `GenerateKeyForm` component and improve validation logic ([41a4bd2](https://github.com/threenine/diogel/commit/41a4bd2))
- Add unit tests for `KeyManagementTable` component ([0f70497](https://github.com/threenine/diogel/commit/0f70497))
- Extend `KeyManagementPage` tests to cover key actions and table rendering ([5cc79aa](https://github.com/threenine/diogel/commit/5cc79aa))
- Add unit tests for ApprovedClientsCard and improve service test coverage ([b949ff7](https://github.com/threenine/diogel/commit/b949ff7))

### ❤️ Contributors

- Gary Woodfine <annex-storage-slip@duck.com>

## v0.0.19

[compare changes](https://github.com/threenine/diogel/compare/0.0.18-3690444...v0.0.19)

### 🚀 Enhancements

- Update permission duration to support '8h' option ([2b3ea1a](https://github.com/threenine/diogel/commit/2b3ea1a))
- Enforce validation for unsupported permission durations ([f730cb0](https://github.com/threenine/diogel/commit/f730cb0))

### 🏡 Chore

- Replace `console` statements with `logService` for unified logging, add debug mode checks, and enhance error verbosity across services and components ([c88eef8](https://github.com/threenine/diogel/commit/c88eef8))
- Refactor type usage in bridge messaging, simplify and enforce type safety across handlers, tests, and services ([5e510d9](https://github.com/threenine/diogel/commit/5e510d9))
- Update memory version to 3.0, remove feedback file, and adjust release script ([3586ddf](https://github.com/threenine/diogel/commit/3586ddf))

### ✅ Tests

- Add unit tests for `PermissionHandler` ([99687e9](https://github.com/threenine/diogel/commit/99687e9))
- Add unit tests for invalid and edge cases in `PermissionHandler` ([32de819](https://github.com/threenine/diogel/commit/32de819))
- Add non-null assertions to autoLockTimer invocation order checks in `dispatcher` unit tests ([cc2102c](https://github.com/threenine/diogel/commit/cc2102c))

### ❤️ Contributors

- Gary Woodfine <gary.woodfine@threenine.co.uk>

## v0.0.18

[compare changes](https://github.com/threenine/diogel/compare/v0.0.17...v0.0.18)

### 🚀 Enhancements

- Conditionally render AccountDropdown based on vaultStore unlock state ([ba47579](https://github.com/threenine/diogel/commit/ba47579))
- Add unit tests for BlossomHandler, Nip04Handler, and Nip07Handler; refactor i18n keys for reusability ([904ba02](https://github.com/threenine/diogel/commit/904ba02))
- Improve vault error handling, update unit tests, and enhance login failure UX ([8aa3778](https://github.com/threenine/diogel/commit/8aa3778))
- Add i18n keys for avatar and banner titles, update related components ([65f93a3](https://github.com/threenine/diogel/commit/65f93a3))
- Add `normalizeRelayUrl` validator with unit tests ([f51543d](https://github.com/threenine/diogel/commit/f51543d))
- Add `normalizeRelayUrl` validator with unit tests ([ac36157](https://github.com/threenine/diogel/commit/ac36157))
- Add `RelayCatalogService.getEntries` with unit tests ([452ae99](https://github.com/threenine/diogel/commit/452ae99))

### 🩹 Fixes

- Replace deprecated `<q-spacer>` with `<q-space>` in RelayBrowserModal ([e2f8cc7](https://github.com/threenine/diogel/commit/e2f8cc7))

### 📖 Documentation

- Add DEPLOYMENT.md for automated Chrome/Firefox extension publishing ([3bb2fbd](https://github.com/threenine/diogel/commit/3bb2fbd))
- Update README and footer, adjust documentation authors ([61a7250](https://github.com/threenine/diogel/commit/61a7250))
- Update README and footer, adjust documentation authors ([65656ae](https://github.com/threenine/diogel/commit/65656ae))
- Update README and footer, adjust documentation authors ([e834726](https://github.com/threenine/diogel/commit/e834726))
- Remove outdated Phase 2 Relay Browser note and update documentation structure ([d8f4099](https://github.com/threenine/diogel/commit/d8f4099))

### 🏡 Chore

- Refactor key export logic, add validation and improve key backup formatting ([4982a40](https://github.com/threenine/diogel/commit/4982a40))
- Add unit tests for `generateKeyExportText` in compressor service to validate export formatting and error handling ([9f30f27](https://github.com/threenine/diogel/commit/9f30f27))
- Simplify import paths, update mocked service references, and enhance TypeScript typings in unit tests ([7ddc24b](https://github.com/threenine/diogel/commit/7ddc24b))
- Standardize zip name handling in GitHub workflows, update README with deployment guide ([cec1e2e](https://github.com/threenine/diogel/commit/cec1e2e))
- Simplify key export logic in `compressor.ts` by removing redundant error handling and improving validation ([f4f0b4b](https://github.com/threenine/diogel/commit/f4f0b4b))
- Make `generateKeyExportText` the default export and handle encoding errors gracefully in `compressor.ts` ([32e4083](https://github.com/threenine/diogel/commit/32e4083))
- Add `relay.browser.list` and `relay.browser.getStatus` handlers, integrate with dispatcher, and add unit tests ([361b7fe](https://github.com/threenine/diogel/commit/361b7fe))
- Add `RelayBrowserModal` and `RelayEditor` components with unit tests, integrate relay browsing functionality, and extend i18n for related strings ([5fa1aaa](https://github.com/threenine/diogel/commit/5fa1aaa))
- Export `sendBexMessage`, seed relay catalog on startup, and enhance `RelayBrowserModal` with relay listing and unit tests ([3746da8](https://github.com/threenine/diogel/commit/3746da8))
- Add `listRelayCatalog` function to fetch relay catalog entries from the background ([446ad0e](https://github.com/threenine/diogel/commit/446ad0e))
- Refactor `handleRelayBrowserGetStatus` to use `relayCatalogService` for discovery state management, add staleness checks, and update unit tests ([79a7500](https://github.com/threenine/diogel/commit/79a7500))
- Add `RelayDiscoveryService` for bounded relay discovery, implement staleness checks, update URL normalization, and include comprehensive unit tests ([aedd0fc](https://github.com/threenine/diogel/commit/aedd0fc))
- Add `RelayMetadataService` with `getNip11Url` and `fetchRelayMetadata` functions, implement comprehensive unit tests for URL conversion and metadata fetching ([b362b39](https://github.com/threenine/diogel/commit/b362b39))
- Add `upsertEntry` method to `RelayCatalogService` with advanced merging logic, update seed handling and include comprehensive unit tests ([4599c0c](https://github.com/threenine/diogel/commit/4599c0c))
- Add `RelayBrowserOrchestrator` for managing relay discovery and metadata refresh, implement `relay.browser.refresh` handler, and include comprehensive unit tests ([1fc4f96](https://github.com/threenine/diogel/commit/1fc4f96))
- Enhance `RelayBrowserModal` with relay filtering, sorting, and search capabilities, add refresh and discovery status handling, update unit tests, and extend i18n strings ([b32bdda](https://github.com/threenine/diogel/commit/b32bdda))
- Enhance `RelayCatalogService` with status downgrade protection and `lastSeen` updates, add relay icon in `RelayBrowserModal`, and update related tests ([14618ea](https://github.com/threenine/diogel/commit/14618ea))
- Improve error handling and finalize loading state in `RelayBrowserModal` and `RelayBrowserOrchestrator` during relay discovery and refresh processes ([cfb5a16](https://github.com/threenine/diogel/commit/cfb5a16))
- Refactor `RelayEditor` to default Write permission to false, update relay addition logic, adjust related tests with improved stubbing ([c2a1258](https://github.com/threenine/diogel/commit/c2a1258))
- Add pagination to `RelayBrowserModal`, update entry validity checks in `RelayCatalogService`, enhance i18n strings, and extend unit tests ([fef2b71](https://github.com/threenine/diogel/commit/fef2b71))
- Update `RelayBrowserModal` to improve relay discovery logic with staleness checks, refine polling behavior, and revise auto-refresh trigger conditions; update unit tests accordingly ([6dcf43b](https://github.com/threenine/diogel/commit/6dcf43b))
- Refactor `RelayBrowserOrchestrator` to modularize discovery and metadata refresh logic, improve handling of seed catalog initialization, and update unit tests with eslint adjustments ([feb891f](https://github.com/threenine/diogel/commit/feb891f))
- Implement concurrent metadata fetching with a configurable limit in `RelayBrowserOrchestrator`, update stale entry processing logic, and add unit tests for concurrency and error isolation ([aac7d7f](https://github.com/threenine/diogel/commit/aac7d7f))
- Remove UI-level sorting from `RelayBrowserModal`, delegate canonical sorting to `RelayCatalogService`, refactor `filterAndSortRelays` to `filterRelays`, and update corresponding tests and guidelines ([ef2e24c](https://github.com/threenine/diogel/commit/ef2e24c))
- Add fallback relays to `SettingsStore` with default values, enable storage-backed persistence, and implement corresponding unit tests ([6783ac1](https://github.com/threenine/diogel/commit/6783ac1))
- Replace hardcoded relay lists with `SettingsStore` fallback relays, ensure seamless persistence, and update related components and tests ([0b8388f](https://github.com/threenine/diogel/commit/0b8388f))
- Enhance relay validation with stricter URL, metadata, and staleness checks in `RelayCatalogService`; refine scoring logic and update unit tests ([ea02bd4](https://github.com/threenine/diogel/commit/ea02bd4))
- Update `RelayBrowserModal` to improve close button behavior, refine pagination styling, and optimize conditional rendering; update unit tests to enhance coverage ([fc22965](https://github.com/threenine/diogel/commit/fc22965))
- Replace `console` statements with `logService` for consistent logging across services and components ([b5e2037](https://github.com/threenine/diogel/commit/b5e2037))
- Standardize custom scrollbar with `diogel-scrollbar`, remove redundant styles, and apply globally to reusable components ([854378e](https://github.com/threenine/diogel/commit/854378e))
- Integrate storage-backed fallback relays into `RelayCatalogService` seeds, improve error logging in `RelayBrowserOrchestrator`, and enhance unit tests ([a020123](https://github.com/threenine/diogel/commit/a020123))
- Integrate storage-backed fallback relays into `RelayCatalogService` seeds, improve error logging in `RelayBrowserOrchestrator`, and enhance unit tests ([05e9442](https://github.com/threenine/diogel/commit/05e9442))
- Upgrade `axios` to v1.15.0 and update `proxy-from-env` to v2.1.0 ([caa7aec](https://github.com/threenine/diogel/commit/caa7aec))

### ✅ Tests

- Add unit tests for `logService` and `storageService` ([cace917](https://github.com/threenine/diogel/commit/cace917))
- Add comprehensive unit tests for `RelayBrowserModal` to validate clean profile behaviors, auto-refresh triggers, and relay discovery flow ([b69af67](https://github.com/threenine/diogel/commit/b69af67))
- Expand unit tests for `normalizeRelayUrl` and `isRestrictedHostname`, integrate stricter validation in `RelayCatalogService`, and update dependent components and orchestrators ([d93bdf2](https://github.com/threenine/diogel/commit/d93bdf2))

### ❤️ Contributors

- Gary Woodfine <gary.woodfine@threenine.co.uk>

## v0.0.17

[compare changes](https://github.com/threenine/diogel/compare/v0.0.16...v0.0.17)

### 🩹 Fixes

- Update publish workflows with proper action versions and validation ([81e4c35](https://github.com/threenine/diogel/commit/81e4c35))
- Prevent AccountDropdown from redirecting away from approval popup ([ec629cd](https://github.com/threenine/diogel/commit/ec629cd))
- Improve SignerApproval layout in popup ([7edd042](https://github.com/threenine/diogel/commit/7edd042))
- Remove broken type imports from content-script.ts ([8b8dec0](https://github.com/threenine/diogel/commit/8b8dec0))

### 🏡 Chore

- **release:** V0.0.16 ([130c000](https://github.com/threenine/diogel/commit/130c000))
- Improve code formatting, update primary color variable, and adjust Quasar dark mode configuration ([d49b74b](https://github.com/threenine/diogel/commit/d49b74b))
- Add typography styles and update color variables for consistent theming across components ([7d33064](https://github.com/threenine/diogel/commit/7d33064))
- Update button styles and introduce brand-specific classes for consistent design ([fae7eb5](https://github.com/threenine/diogel/commit/fae7eb5))
- Update button styles and introduce brand-specific classes for consistent design ([c3b7f33](https://github.com/threenine/diogel/commit/c3b7f33))
- Update card styles, improve ProfileView layout, and refine SCSS structure for consistent design ([ddf4148](https://github.com/threenine/diogel/commit/ddf4148))
- Remove unnecessary inline style from ExtensionWindowHeader component ([5101a86](https://github.com/threenine/diogel/commit/5101a86))
- Make header logo dynamic based on Quasar dark mode toggle ([1c43f93](https://github.com/threenine/diogel/commit/1c43f93))
- Add header assets for light and dark modes ([aa6d32d](https://github.com/threenine/diogel/commit/aa6d32d))
- Update AccountDropdown UI and add standardized select dropdown styles ([d967462](https://github.com/threenine/diogel/commit/d967462))
- Add smooth transitions, skeleton loaders, and accessibility-focused animations for interactive components ([06b8616](https://github.com/threenine/diogel/commit/06b8616))
- Refactor bridge definitions and improve type safety across content script and background handlers ([5abfc2c](https://github.com/threenine/diogel/commit/5abfc2c))
- Add centralized error handling with `ErrorCode` enums and metadata, refactor vault service responses for consistency ([8df09b7](https://github.com/threenine/diogel/commit/8df09b7))
- Add `BridgeAction` type import to improve type safety in content script ([5e451e8](https://github.com/threenine/diogel/commit/5e451e8))
- Add Web Crypto API mocks for unit tests, update Vitest config with setup file, and enhance vault tests with crypto operations ([768c8c5](https://github.com/threenine/diogel/commit/768c8c5))
- Bump package version to 0.0.16 in package-lock.json ([ebd2571](https://github.com/threenine/diogel/commit/ebd2571))
- Update import paths for bridge types to fix relative path resolution in background and content scripts ([6d90e0d](https://github.com/threenine/diogel/commit/6d90e0d))
- Add `background.ts` with types for background script and NIP-07 interface definitions ([1eeff24](https://github.com/threenine/diogel/commit/1eeff24))
- Refactor auto-lock mechanism into a dedicated service, update background interactions for improved modularity ([7c8489c](https://github.com/threenine/diogel/commit/7c8489c))
- Refactor vault operations into dedicated handlers and update `background.ts` to use typed interfaces for improved modularity ([49aab4a](https://github.com/threenine/diogel/commit/49aab4a))
- Refactor permission handling into a dedicated module and update `background.ts` to use standardized permission checks ([a74fe8e](https://github.com/threenine/diogel/commit/a74fe8e))
- Add Firefox-specific build command to package.json ([4ae95d0](https://github.com/threenine/diogel/commit/4ae95d0))
- Fix type casting for private key in `background.ts` to align with nostr-tools usage ([7bf157a](https://github.com/threenine/diogel/commit/7bf157a))
- Add NIP-07 `handleGetPublicKey` handler and integrate with bridge approvals in `background.ts` ([d0a6751](https://github.com/threenine/diogel/commit/d0a6751))
- Add `handleSignEvent` NIP-07 handler and refactor `nostr.signEvent` logic for modularity and error handling ([5eb4440](https://github.com/threenine/diogel/commit/5eb4440))
- Add i18n support for theme and auto-lock labels in settings and refactor to use localized strings ([eebaf31](https://github.com/threenine/diogel/commit/eebaf31))
- Update Node.js version in `.nvmrc` to v24.14.0 and add placeholder section in README ([e7ee973](https://github.com/threenine/diogel/commit/e7ee973))

### ❤️ Contributors

- Gary Woodfine <gary.woodfine@threenine.co.uk>
- Root <root@openclaw.cable.virginm.net>

## v0.0.16

[compare changes](https://github.com/threenine/diogel/compare/v0.0.15...v0.0.16)

### 🚀 Enhancements

- Define explicit TypeScript interfaces for bridge requests, responses, and errors related to `nostr` event handling ([0d4212a](https://github.com/threenine/diogel/commit/0d4212a))

### 💅 Refactors

- Use constants for message types and timing values across content and background scripts ([8dcb918](https://github.com/threenine/diogel/commit/8dcb918))
- Replace `any` types with explicit bridge request/response types and enhance error handling for `nostr` event methods ([7279250](https://github.com/threenine/diogel/commit/7279250))

### 📖 Documentation

- Add PRIVACY.md detailing privacy policy and terms of service ([3344414](https://github.com/threenine/diogel/commit/3344414))

### 🏡 Chore

- Add `typecheck` script to package.json using `vue-tsc` for type safety ([079b087](https://github.com/threenine/diogel/commit/079b087))

### ✅ Tests

- Include `tests/**/*.test.{ts,js}` in Vitest configuration ([0c85ffe](https://github.com/threenine/diogel/commit/0c85ffe))
- Add unit tests for vault operations and introduce constants for message types and timing values ([9181c04](https://github.com/threenine/diogel/commit/9181c04))

### ❤️ Contributors

- Gary Woodfine <lnb0l9dc@duck.com>

## v0.0.15

[compare changes](https://github.com/threenine/diogel/compare/v0.0.14...v0.0.15)

## v0.0.14

[compare changes](https://github.com/threenine/diogel/compare/v0.0.13...v0.0.14)

### 🚀 Enhancements

- Enhance redirect handling, logging, and message consistency ([8ad25bd](https://github.com/threenine/diogel/commit/8ad25bd))
- Add hostname column to logs and adjust dropdown width in AccountList ([01b9547](https://github.com/threenine/diogel/commit/01b9547))
- Add "Remember this choice" option in SignerApproval ([74f415b](https://github.com/threenine/diogel/commit/74f415b))
- Add "Remember this choice" option in SignerApproval ([613b533](https://github.com/threenine/diogel/commit/613b533))

### 🏡 Chore

- Replace "nostr-ext" with "diogel" in message handling; simplify error messages ([6f6721a](https://github.com/threenine/diogel/commit/6f6721a))

### ❤️ Contributors

- Gary Woodfine <annex-storage-slip@duck.com>

## v0.0.13

[compare changes](https://github.com/threenine/diogel/compare/v0.0.12...v0.0.13)

### 🚀 Enhancements

- Add Firefox Web Store publishing workflow and improve manifest/browser-specific support ([5b00ba9](https://github.com/threenine/diogel/commit/5b00ba9))

### 📖 Documentation

- Update README with badges and warning block formatting ([206753a](https://github.com/threenine/diogel/commit/206753a))

### 🏡 Chore

- Adjust UI dimensions, styling, and scrolling behavior ([8f785c3](https://github.com/threenine/diogel/commit/8f785c3))
- Update diogel-header image in assets ([36a9372](https://github.com/threenine/diogel/commit/36a9372))
- Upgrade dependencies, add `MainNavigation` component, and implement unlock popup handling on vault lock ([f6137b4](https://github.com/threenine/diogel/commit/f6137b4))

### ❤️ Contributors

- Gary Woodfine <lnb0l9dc@duck.com>

## v0.0.12

[compare changes](https://github.com/threenine/diogel/compare/v0.0.11...v0.0.12)

### 🚀 Enhancements

- Add favicon display for site origin and fix header image path ([3d1c9d1](https://github.com/threenine/diogel/commit/3d1c9d1))

### 🏡 Chore

- Refactor layouts and styles for consistent UI alignment and popup responsiveness ([79a28a1](https://github.com/threenine/diogel/commit/79a28a1))
- Add MIT license and adjust UI styling for ProfileView and page container ([c892a34](https://github.com/threenine/diogel/commit/c892a34))
- Update file structure, adjust styles, and add logout option ([93746d1](https://github.com/threenine/diogel/commit/93746d1))

### ❤️ Contributors

- Gary Woodfine <annex-storage-slip@duck.com>

## v0.0.11

[compare changes](https://github.com/threenine/diogel/compare/v0.0.10...v0.0.11)

### 💅 Refactors

- Relocate export keys warning for better visibility and UI consistency ([4eac96c](https://github.com/threenine/diogel/commit/4eac96c))

### ❤️ Contributors

- Gary Woodfine <annex-storage-slip@duck.com>

## v0.0.10

[compare changes](https://github.com/threenine/diogel/compare/v0.0.9...v0.0.10)

### 🚀 Enhancements

- Improve user notifications and interface consistency ([8503eb1](https://github.com/threenine/diogel/commit/8503eb1))

### 📖 Documentation

- Add installation guide for browser extension to README.md ([d080a9b](https://github.com/threenine/diogel/commit/d080a9b))

### 🏡 Chore

- **release:** V0.0.9 ([dfd96dd](https://github.com/threenine/diogel/commit/dfd96dd))

### ❤️ Contributors

- Gary Woodfine <annex-storage-slip@duck.com>

## v0.0.9

[compare changes](https://github.com/threenine/diogel/compare/v0.0.8...v0.0.9)

### 🏡 Chore

- Improve release workflow to handle existing releases and validate zip file before upload ([0905325](https://github.com/threenine/diogel/commit/0905325))

### ❤️ Contributors

- Gary Woodfine <annex-storage-slip@duck.com>

## v0.0.8

[compare changes](https://github.com/threenine/diogel/compare/v0.0.7...v0.0.8)

### 🏡 Chore

- Update release workflow to improve tag handling and enable autogenerated release notes ([b27917e](https://github.com/threenine/diogel/commit/b27917e))

### ❤️ Contributors

- Gary Woodfine <annex-storage-slip@duck.com>

## v0.0.7

[compare changes](https://github.com/threenine/diogel/compare/v0.0.6...v0.0.7)

### 🏡 Chore

- Update publish workflow to enable release creation and adjust zip packaging ([5a9fb51](https://github.com/threenine/diogel/commit/5a9fb51))
- Update contributor email in changelog ([6787603](https://github.com/threenine/diogel/commit/6787603))

### ❤️ Contributors

- Gary Woodfine <annex-storage-slip@duck.com>

## v0.0.6

[compare changes](https://github.com/threenine/diogel/compare/v0.0.5...v0.0.6)

### 🏡 Chore

- Update manifest to run scripts at document_end and bump version to 0.0.5 ([ddf8d3e](https://github.com/threenine/diogel/commit/ddf8d3e))

### ❤️ Contributors

- Gary Woodfine <annex-storage-slip@duck.com>

## v0.0.5

[compare changes](https://github.com/threenine/diogel/compare/v0.0.4...v0.0.5)

### 🏡 Chore

- Updating permissions to activeTab ([1618007](https://github.com/threenine/diogel/commit/1618007))

### ❤️ Contributors

- Gary Woodfine <annex-storage-slip@duck.com>

## v0.0.4

[compare changes](https://github.com/threenine/diogel/compare/v0.0.3...v0.0.4)

### 🏡 Chore

- Refine `manifest.json`: remove unused `host_permissions` field and minor formatting adjustments. ([42bca21](https://github.com/threenine/diogel/commit/42bca21))

### ❤️ Contributors

- Gary Woodfine <annex-storage-slip@duck.com>

## v0.0.3

[compare changes](https://github.com/threenine/diogel/compare/v0.0.2...v0.0.3)

## v0.0.2
