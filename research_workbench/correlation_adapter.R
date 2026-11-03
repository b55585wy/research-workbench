options(warn=1,digits=17)
p <- read.delim("correlation-options.tsv",colClasses="character",check.names=FALSE,
    na.strings=character(),comment.char="")
d <- read.delim("input.tsv",colClasses=c("numeric","numeric"),check.names=FALSE,
    na.strings=character(),comment.char="")
stopifnot(p$kind %in% c("pearson","spearman"),p$alternative %in% c("two_sided","greater","less"),
    !anyNA(d),nrow(d)>=3,all(is.finite(d$first)),all(is.finite(d$second)))
alternative <- if(p$alternative=="two_sided") "two.sided" else p$alternative
if (p$kind=="pearson") {
    r <- stats::cor.test(d$first,d$second,method="pearson",alternative=alternative,
        conf.level=as.numeric(p$confidence))
} else {
    r <- stats::cor.test(d$first,d$second,method="spearman",alternative=alternative,exact=FALSE,continuity=FALSE)
}
ci <- r$conf.int
result <- data.frame(estimate=unname(r$estimate),estimate_name=names(r$estimate),
    statistic=unname(r$statistic),statistic_name=names(r$statistic),
    df=if(length(r$parameter)) unname(r$parameter) else NA_real_,p_value=r$p.value,n=nrow(d),
    ci_lower=if(length(ci)) ci[1] else NA_real_,ci_upper=if(length(ci)) ci[2] else NA_real_,
    confidence=if(length(ci)) attr(ci,"conf.level") else NA_real_,
    stats_version=as.character(packageVersion("stats")),r_version=R.version.string,check.names=FALSE)
write.table(result,"r-correlation-result.tsv",sep="\t",quote=TRUE,row.names=FALSE,
    fileEncoding="UTF-8",eol="\n",na="")
cat("Completed correlation using R stats::cor.test; Spearman uses asymptotic p-values.\n")
