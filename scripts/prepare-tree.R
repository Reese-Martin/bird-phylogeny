# Independent audit of the exact pinned NEXUS and browser tree.
# Requires R >= 4.3, ape >= 5.8, clootl 0.1.5, jsonlite and digest.
# Uses clootl's packaged v1.7/2025 tree, without a mutable network download.
# Run: Rscript scripts/prepare-tree.R
if (.Platform$OS.type == "windows") invisible(Sys.setlocale("LC_CTYPE", "English_United States.utf8"))
if (.Platform$OS.type == "windows") {
  r_minor <- strsplit(R.version$minor, ".", fixed=TRUE)[[1]][1]
  local_roots <- c(Sys.getenv("LOCALAPPDATA"), file.path(Sys.getenv("USERPROFILE"), "AppData", "Local"))
  user_libraries <- file.path(local_roots, "R", "win-library", paste(R.version$major, r_minor, sep="."))
  .libPaths(c(user_libraries[dir.exists(user_libraries)], .libPaths()))
}
if (dir.exists("data/raw/R-library")) .libPaths(c(normalizePath("data/raw/R-library"), .libPaths()))
if (!requireNamespace("ape", quietly=TRUE)) stop("Install ape first: install.packages('ape')")
if (!requireNamespace("clootl", quietly=TRUE)) stop("Install clootl first: install.packages('clootl')")
# clootl 0.1.5's internal data loader needs the package attached.
suppressPackageStartupMessages(library(clootl))
tree <- ape::read.nexus("data/raw/tree.nex")
stopifnot(length(tree$tip.label) == 11167, !anyDuplicated(tree$tip.label))
stopifnot(all(is.finite(tree$edge.length)), all(tree$edge.length >= 0))
depths <- ape::node.depth.edgelength(tree)[seq_along(tree$tip.label)]
normalized <- tree
normalized$tip.label <- gsub("_", " ", tree$tip.label, fixed=TRUE)
authors_tree <- clootl::extractTree(version="1.7", taxonomy_year=2025)
same <- ape::all.equal.phylo(normalized, authors_tree, use.edge.length=TRUE, tolerance=1e-10)
stopifnot(isTRUE(same))
prepared <- jsonlite::fromJSON("public/data/tree.json")
browser_depths <- setNames(prepared$nodes$distance[prepared$tips + 1], prepared$nodes$name[prepared$tips + 1])
errors <- abs(depths - browser_depths[normalized$tip.label])
stopifnot(all(is.finite(errors)), max(errors) < 1e-10)
stopifnot(identical(normalized$tip.label, prepared$nodes$name[prepared$tips + 1]))
# Compare all rooted clades and incoming branch lengths using source leaf order.
# This verifies topology independently of dataset-scoped node numbering.
ntip <- length(tree$tip.label)
total <- ntip + tree$Nnode
lo <- rep(Inf, total); hi <- rep(-Inf, total)
lo[seq_len(ntip)] <- seq_len(ntip); hi[seq_len(ntip)] <- seq_len(ntip)
post <- ape::reorder.phylo(tree, order="postorder")
for (i in seq_len(nrow(post$edge))) {
  p <- post$edge[i,1]; child <- post$edge[i,2]
  lo[p] <- min(lo[p], lo[child]); hi[p] <- max(hi[p], hi[child])
}
source_keys <- paste(lo, hi, sep=":")
browser_keys <- paste(prepared$nodes$leafStart + 1, prepared$nodes$leafEnd, sep=":")
stopifnot(!anyDuplicated(source_keys), setequal(source_keys, browser_keys))
incoming <- rep(0, total)
incoming[tree$edge[,2]] <- tree$edge.length
branch_errors <- abs(prepared$nodes$length - incoming[match(browser_keys, source_keys)])
stopifnot(all(is.finite(branch_errors)), max(branch_errors) < 1e-10)
cat("ape version:", as.character(utils::packageVersion("ape")), "\n")
cat("Tips:", length(tree$tip.label), "Nodes:", tree$Nnode, "\n")
cat("Root-to-tip range (approx. million years):", range(depths), "\n")
cat("Authors' packaged tree agrees:", same, "\n")
cat("Maximum browser/ape root-distance error:", max(errors), "\n")
cat("Maximum browser/ape branch-length error:", max(branch_errors), "\n")
stopifnot(diff(range(depths)) < 0.001)
write.csv(data.frame(name=tree$tip.label, distance=depths), "data/raw/ape-audit.csv", row.names=FALSE)
# Read the actual bytes: Windows ACL checks via file.access can report -1 in a
# restricted process even when opening/reading the file succeeds. Failed reads
# still abort; this hashes the same file bytes as digest(file=...).
sha256_file <- function(path) digest::digest(readBin(path, "raw", n=file.info(path)$size), algo="sha256", serialize=FALSE)
audit <- list(checkedAt=format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz="UTC"),
  R=R.version.string, ape=as.character(utils::packageVersion("ape")), clootl=as.character(utils::packageVersion("clootl")),
  sourceSha256=sha256_file("data/raw/tree.nex"),
  preparedTreeSha256=sha256_file("public/data/tree.json"),
  tipCount=length(tree$tip.label), internalNodeCount=tree$Nnode,
  authorPackagedTreeAgrees=TRUE, browserTopologyAgrees=TRUE, browserLeafOrderAgrees=TRUE,
  maxBrowserRootDistanceError=max(errors), maxBrowserBranchLengthError=max(branch_errors), toleranceMya=1e-10)
citations <- clootl::getCitations(authors_tree, version=1.7)
write.csv(citations, "public/data/tree-citations.csv", row.names=FALSE, fileEncoding="UTF-8")
audit$studyCitationEntries <- nrow(citations)
audit$studyCitationsSha256 <- sha256_file("public/data/tree-citations.csv")
jsonlite::write_json(audit, "public/data/tree-audit.json", auto_unbox=TRUE, pretty=TRUE, digits=16)
