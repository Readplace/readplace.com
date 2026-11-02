import { combineSurfaces } from "./define-surface";
import { common } from "./surfaces/common";
import { shell } from "./surfaces/shell";
import { hutchAuth } from "./surfaces/hutch-auth";
import { hutchReadlist } from "./surfaces/hutch-readlist";
import { hutchReader } from "./surfaces/hutch-reader";
import { hutchAccount } from "./surfaces/hutch-account";
import { hutchIntegrations } from "./surfaces/hutch-integrations";
import { hutchEmails } from "./surfaces/hutch-emails";
import { inbox } from "./surfaces/inbox";
import { blogSite } from "./surfaces/blog-site";
import { webEmbed } from "./surfaces/web-embed";

export const WEB_CATALOG = combineSurfaces({
	"common": common,
	"shell": shell,
	"hutch-auth": hutchAuth,
	"hutch-readlist": hutchReadlist,
	"hutch-reader": hutchReader,
	"hutch-account": hutchAccount,
	"hutch-integrations": hutchIntegrations,
	"hutch-emails": hutchEmails,
	"inbox": inbox,
	"blog-site": blogSite,
	"web-embed": webEmbed,
});
