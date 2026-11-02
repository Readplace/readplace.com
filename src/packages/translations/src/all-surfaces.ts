import { common } from "./surfaces/common";
import { shell } from "./surfaces/shell";
import { hutchAuth } from "./surfaces/hutch-auth";
import { hutchReadlist } from "./surfaces/hutch-readlist";
import { hutchReader } from "./surfaces/hutch-reader";
import { hutchAccount } from "./surfaces/hutch-account";
import { hutchIntegrations } from "./surfaces/hutch-integrations";
import { hutchEmails } from "./surfaces/hutch-emails";
import { hutchApi } from "./surfaces/hutch-api";
import { hutchStored } from "./surfaces/hutch-stored";
import { inbox } from "./surfaces/inbox";
import { blogSite } from "./surfaces/blog-site";
import { webEmbed } from "./surfaces/web-embed";
import { browserExtension } from "./surfaces/browser-extension";

export const ALL_SURFACES = {
	"common": common,
	"shell": shell,
	"hutch-auth": hutchAuth,
	"hutch-readlist": hutchReadlist,
	"hutch-reader": hutchReader,
	"hutch-account": hutchAccount,
	"hutch-integrations": hutchIntegrations,
	"hutch-emails": hutchEmails,
	"hutch-api": hutchApi,
	"hutch-stored": hutchStored,
	"inbox": inbox,
	"blog-site": blogSite,
	"web-embed": webEmbed,
	"browser-extension": browserExtension,
};
