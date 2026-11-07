CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`opening_balance_minor` integer DEFAULT 0 NOT NULL,
	`opening_balance_date` text NOT NULL,
	`entity_id` text,
	`processor_id` text,
	`institution` text,
	`is_business` integer DEFAULT true NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alert_snoozes` (
	`alert_key` text PRIMARY KEY NOT NULL,
	`snoozed_until` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `allocation_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`bucket` text NOT NULL,
	`amount_usd_cents` integer NOT NULL,
	`source` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `allocation_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`applies_from_monthly_revenue_usd_cents` integer DEFAULT 0 NOT NULL,
	`opex_pct` text NOT NULL,
	`owner_pct` text NOT NULL,
	`tax_pct` text NOT NULL,
	`profit_pct` text NOT NULL,
	`reserve_pct` text NOT NULL,
	`growth_pct` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope` text NOT NULL,
	`is_essential_default` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_system` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `client_revenue_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`month` text NOT NULL,
	`client_attributable_revenue_usd_cents` integer DEFAULT 0 NOT NULL,
	`revenue_share_pct` text,
	`commission_usd_cents` integer DEFAULT 0 NOT NULL,
	`retainer_usd_cents` integer DEFAULT 0 NOT NULL,
	`fixed_fees_usd_cents` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`agreement_type` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`revenue_share_pct` text,
	`monthly_retainer_usd_cents` integer DEFAULT 0 NOT NULL,
	`fixed_fee_usd_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`entity_id` text,
	`payment_terms_days` integer DEFAULT 7 NOT NULL,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `compliance_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`jurisdiction` text NOT NULL,
	`description` text,
	`due_date` text,
	`frequency` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`applicable` integer DEFAULT true NOT NULL,
	`value_label` text,
	`value` text,
	`last_completed_at` text,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`jurisdiction` text NOT NULL,
	`registration_number` text,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`currency` text NOT NULL,
	`rate_per_usd` text NOT NULL,
	`source` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `growth_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`monthly_cost_usd_cents` integer DEFAULT 0 NOT NULL,
	`one_time_cost_usd_cents` integer DEFAULT 0 NOT NULL,
	`expected_additional_revenue_usd_cents` integer DEFAULT 0 NOT NULL,
	`expected_benefit` text,
	`delivery_capacity_usd_cents` integer DEFAULT 0 NOT NULL,
	`cost_type` text DEFAULT 'overhead' NOT NULL,
	`bucket` text DEFAULT 'growth' NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`evaluation_json` text,
	`decision_note` text,
	`created_at` text NOT NULL,
	`decided_at` text
);
--> statement-breakpoint
CREATE TABLE `household_budget_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'PKR' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`number` text,
	`period_month` text NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text NOT NULL,
	`expected_payment_date` text,
	`amount_usd_cents` integer NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `month_closes` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`status` text DEFAULT 'closed' NOT NULL,
	`closed_at` text NOT NULL,
	`reopened_at` text,
	`report_json` text NOT NULL,
	`checklist_json` text,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `month_closes_month_unique` ON `month_closes` (`month`);--> statement-breakpoint
CREATE TABLE `processor_reserves` (
	`id` text PRIMARY KEY NOT NULL,
	`processor_id` text NOT NULL,
	`amount_usd_cents` integer NOT NULL,
	`date_withheld` text NOT NULL,
	`expected_release_date` text,
	`released_date` text,
	`status` text DEFAULT 'held' NOT NULL,
	`reason` text,
	`hold_transaction_id` text,
	`release_transaction_id` text,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `processors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`available_account_id` text,
	`restricted_account_id` text,
	`domestic_card_pct` text DEFAULT '2.7' NOT NULL,
	`domestic_card_fixed_cents` integer DEFAULT 30 NOT NULL,
	`intl_card_surcharge_pct` text DEFAULT '1.5' NOT NULL,
	`conversion_pct` text DEFAULT '1' NOT NULL,
	`platform_fee_pct` text DEFAULT '3' NOT NULL,
	`platform_fee_applies_by_default` integer DEFAULT true NOT NULL,
	`ach_payout_fee_cents` integer DEFAULT 250 NOT NULL,
	`wire_payout_fee_cents` integer DEFAULT 2500 NOT NULL,
	`intl_transfer_fee_cents` integer DEFAULT 2500 NOT NULL,
	`intl_transfer_pct` text DEFAULT '1' NOT NULL,
	`instant_payout_pct` text DEFAULT '4' NOT NULL,
	`instant_payout_fixed_cents` integer DEFAULT 100 NOT NULL,
	`default_reserve_pct` text DEFAULT '0' NOT NULL,
	`pricing_source` text,
	`pricing_verified_at` text,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurring_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`vendor_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`frequency` text NOT NULL,
	`category_id` text,
	`cost_type` text DEFAULT 'overhead' NOT NULL,
	`bucket` text DEFAULT 'opex' NOT NULL,
	`account_id` text,
	`start_date` text,
	`next_renewal_date` text,
	`cancelled_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`is_essential` integer DEFAULT false NOT NULL,
	`justification` text,
	`roi_estimate_usd_cents` integer,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`business_name` text NOT NULL,
	`owner_name` text NOT NULL,
	`base_currency` text DEFAULT 'USD' NOT NULL,
	`household_currency` text DEFAULT 'PKR' NOT NULL,
	`default_fx_rate_pkr_per_usd` text DEFAULT '280' NOT NULL,
	`household_budget_usd_cents` integer DEFAULT 100000 NOT NULL,
	`discretionary_goal_usd_cents` integer DEFAULT 500000 NOT NULL,
	`target_gross_margin_min_pct` text DEFAULT '65' NOT NULL,
	`target_gross_margin_max_pct` text DEFAULT '75' NOT NULL,
	`reserve_target_months` text DEFAULT '3' NOT NULL,
	`reserve_min_months` text DEFAULT '3' NOT NULL,
	`reserve_max_months` text DEFAULT '6' NOT NULL,
	`concentration_warn_pct` text DEFAULT '50' NOT NULL,
	`concentration_critical_pct` text DEFAULT '75' NOT NULL,
	`opex_ceiling_override_usd_cents` integer,
	`opex_ceiling_override_note` text,
	`opex_ceiling_override_approved_at` text,
	`renewal_reminder_days` integer DEFAULT 7 NOT NULL,
	`invoice_overdue_grace_days` integer DEFAULT 0 NOT NULL,
	`pinned_policy_id` text,
	`theme` text DEFAULT 'system' NOT NULL,
	`secondary_currency_display` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tax_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`jurisdiction` text NOT NULL,
	`entity_id` text,
	`scope` text NOT NULL,
	`assumed_rate_pct` text,
	`is_estimate` integer DEFAULT true NOT NULL,
	`filing_frequency` text,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`month` text NOT NULL,
	`type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`fx_rate_per_usd` text DEFAULT '1' NOT NULL,
	`amount_usd_cents` integer NOT NULL,
	`description` text NOT NULL,
	`category_id` text,
	`account_id` text,
	`to_account_id` text,
	`client_id` text,
	`invoice_id` text,
	`processor_id` text,
	`vendor_id` text,
	`recurring_expense_id` text,
	`group_id` text,
	`cost_type` text,
	`bucket` text,
	`is_essential` integer DEFAULT false NOT NULL,
	`is_recurring` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`notes` text,
	`created_at` text NOT NULL
);
