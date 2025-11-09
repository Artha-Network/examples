# Artha Actions Makefile
# End to end helpers for initiate → fund → deliver → release/refund → status
#
# Why this exists
# - Quick, reproducible demos without switching tools
# - Uses curl and jq to talk to a running actions-server
#
# Requirements
# - bash, curl, jq
# - actions-server reachable at BASE_URL
#
# Configuration
# - Prefer environment variables or an .env file in this folder.
# - Any CLI var can be overridden like: make initiate AMOUNT=0.5
#
# Vars (defaults are safe for local dev)
BASE_URL      ?= http://localhost:8787
API_KEY       ?=
BUYER         ?= BuyerWalletPublicKeyHere
SELLER        ?= SellerWalletPublicKeyHere
MINT          ?= USDC
AMOUNT        ?= 1.00
DELIVERY_BY   ?= 2025-11-30T23:59:59Z
DISPUTE_HOURS ?= 48
DEAL_ID       ?=
EVIDENCE_CID  ?= bafyDEMO
TICKET_FILE   ?= ticket.json   # used by resolve, optional
ACTION        ?= RELEASE       # RELEASE or REFUND

# Persisted deal id file created by `make initiate`
DEAL_FILE := .dealid

# Detect tools early
CURL := $(shell command -v curl 2>/dev/null)
JQ   := $(shell command -v jq 2>/dev/null)

.PHONY: help
help:
	@echo ""
	@echo "Targets:"
	@echo "  health        Check server liveness"
	@echo "  initiate      Create a deal, writes $(DEAL_FILE)"
	@echo "  fund          Build funding tx for buyer"
	@echo "  deliver       Seller marks delivered with evidence CID"
	@echo "  release       Buyer approves release"
	@echo "  refund        Alternate path, refund to buyer"
	@echo "  status        Fetch current deal status"
	@echo "  dispute       Open a dispute with reason and evidence"
	@echo "  resolve       Resolve via signed ticket from $(TICKET_FILE)"
	@echo "  e2e           Run initiate → fund → deliver → release → status"
	@echo ""
	@echo "Variables override example:"
	@echo "  make initiate AMOUNT=0.5 DELIVERY_BY=2025-12-31T23:59:59Z"
	@echo ""

# Internal: ensure curl and jq exist
define REQUIRE_TOOLS
	@if [ -z "$(CURL)" ]; then echo "curl not found"; exit 1; fi
	@if [ -z "$(JQ)" ]; then echo "jq not found"; exit 1; fi
endef

# Internal: auth header if API_KEY is set
define AUTH_HEADER
	$$( [ -n "$(API_KEY)" ] && printf "Authorization: Bearer $(API_KEY)" )
endef

# Internal: assemble URL
define URL
	$(BASE_URL:%/=%)/$1
endef

.PHONY: health
health:
	@$(REQUIRE_TOOLS)
	@echo "GET $(call URL,health)"
	@curl -sSf -H '$(call AUTH_HEADER)' "$(call URL,health)" | jq -C .

# Write deal id helper
define WRITE_DEAL_ID
	@id="$1"; \
	if [ -z "$$id" ] || [ "$$id" = "null" ]; then \
	  echo "No dealId returned"; exit 1; \
	fi; \
	echo "$$id" > $(DEAL_FILE); \
	echo "dealId=$$id"
endef

# Load a deal id from env or file
define READ_DEAL_ID
	@deal="$(DEAL_ID)"; \
	if [ -z "$$deal" ]; then \
	  if [ -f $(DEAL_FILE) ]; then \
	    deal="$$(cat $(DEAL_FILE))"; \
	  fi; \
	fi; \
	if [ -z "$$deal" ]; then echo "No deal id. Set DEAL_ID or run make initiate"; exit 1; fi; \
	echo "$$deal"
endef

.PHONY: initiate
initiate:
	@$(REQUIRE_TOOLS)
	@echo "POST $(call URL,actions/deals/initiate)"
	@BODY=$$(jq -n \
	  --arg title "Makefile escrow: demo gadget" \
	  --arg buyer "$(BUYER)" \
	  --arg seller "$(SELLER)" \
	  --arg mint "$(MINT)" \
	  --arg delivery "$(DELIVERY_BY)" \
	  --argjson amount "$(AMOUNT)" \
	  --argjson hours "$(DISPUTE_HOURS)" \
	  '{title:$$title,buyer:$$buyer,seller:$$seller,amount:$$amount,mint:$$mint,deliveryBy:$$delivery,disputeWindowHours:$$hours}'); \
	  RESP=$$(curl -sSf -H '$(call AUTH_HEADER)' -H "Content-Type: application/json" -X POST "$(call URL,actions/deals/initiate)" --data-binary "$$BODY"); \
	  echo "$$RESP" | jq -C .; \
	  DEAL=$$(echo "$$RESP" | jq -r '.dealId'); \
	  $(call WRITE_DEAL_ID,$$DEAL)

.PHONY: fund
fund:
	@$(REQUIRE_TOOLS)
	@DEAL=$$($(READ_DEAL_ID)); \
	BODY=$$(jq -n --arg d "$$DEAL" --arg p "$(BUYER)" '{dealId:$$d,payer:$$p}'); \
	echo "POST $(call URL,actions/deals/fund)"; \
	curl -sSf -H '$(call AUTH_HEADER)' -H "Content-Type: application/json" -X POST "$(call URL,actions/deals/fund)" --data-binary "$$BODY" | jq -C .

.PHONY: deliver
deliver:
	@$(REQUIRE_TOOLS)
	@DEAL=$$($(READ_DEAL_ID)); \
	BODY=$$(jq -n --arg d "$$DEAL" --arg cid "$(EVIDENCE_CID)" --arg note "Shipped via devnet courier" '{dealId:$$d,evidenceCid:$$cid,note:$$note}'); \
	echo "POST $(call URL,actions/deals/deliver)"; \
	curl -sSf -H '$(call AUTH_HEADER)' -H "Content-Type: application/json" -X POST "$(call URL,actions/deals/deliver)" --data-binary "$$BODY" | jq -C .

.PHONY: release
release:
	@$(REQUIRE_TOOLS)
	@DEAL=$$($(READ_DEAL_ID)); \
	BODY=$$(jq -n --arg d "$$DEAL" --arg a "$(BUYER)" '{dealId:$$d,approver:$$a}'); \
	echo "POST $(call URL,actions/deals/release)"; \
	curl -sSf -H '$(call AUTH_HEADER)' -H "Content-Type: application/json" -X POST "$(call URL,actions/deals/release)" --data-binary "$$BODY" | jq -C .

.PHONY: refund
refund:
	@$(REQUIRE_TOOLS)
	@DEAL=$$($(READ_DEAL_ID)); \
	BODY=$$(jq -n --arg d "$$DEAL" --arg a "$(SELLER)" '{dealId:$$d,approver:$$a}'); \
	echo "POST $(call URL,actions/deals/refund)"; \
	curl -sSf -H '$(call AUTH_HEADER)' -H "Content-Type: application/json" -X POST "$(call URL,actions/deals/refund)" --data-binary "$$BODY" | jq -C .

.PHONY: status
status:
	@$(REQUIRE_TOOLS)
	@DEAL=$$($(READ_DEAL_ID)); \
	echo "GET $(call URL,actions/deals)/$$DEAL"; \
	curl -sSf -H '$(call AUTH_HEADER)' "$(call URL,actions/deals)/$$DEAL" | jq -C .

.PHONY: dispute
dispute:
	@$(REQUIRE_TOOLS)
	@DEAL=$$($(READ_DEAL_ID)); \
	BODY=$$(jq -n --arg d "$$DEAL" --arg reason "Item arrived damaged" --arg cid "$(EVIDENCE_CID)-DISPUTE" '{dealId:$$d,reason:$$reason,evidenceCid:$$cid}'); \
	echo "POST $(call URL,actions/deals/dispute)"; \
	curl -sSf -H '$(call AUTH_HEADER)' -H "Content-Type: application/json" -X POST "$(call URL,actions/deals/dispute)" --data-binary "$$BODY" | jq -C .

.PHONY: resolve
resolve:
	@$(REQUIRE_TOOLS)
	@if [ ! -f "$(TICKET_FILE)" ]; then echo "Missing $(TICKET_FILE). Create a ResolveTicket JSON first."; exit 1; fi
	@DEAL=$$($(READ_DEAL_ID)); \
	BODY=$$(jq -n --arg d "$$DEAL" --slurpfi
